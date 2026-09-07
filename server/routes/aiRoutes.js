const express = require('express');
const router = express.Router();
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Configure Multer for PDF upload using memory storage (10MB limit)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

const VALID_TARGET_TYPES = ['CITY', 'STATE', 'CUSTOM_ZONE', 'REGION', 'DEFAULT'];
const GEMINI_FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-3.6-flash'];
const GEMINI_RETRY_BASE_DELAY_MS = 2000;
const GEMINI_GENERATION_CONFIG = {
  responseMimeType: 'application/json',
  temperature: 0.1
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getGeminiErrorStatus(error) {
  return error?.status || error?.statusCode || error?.response?.status || error?.cause?.status;
}

function getGeminiErrorText(error) {
  return [
    error?.message,
    error?.statusText,
    error?.cause?.message,
    error?.error?.message,
    String(error || '')
  ].filter(Boolean).join(' | ');
}

function isRetryableGeminiError(error) {
  const status = getGeminiErrorStatus(error);
  const errorText = getGeminiErrorText(error);

  return status === 503 || /503|service unavailable|fetch failed/i.test(errorText);
}

function isModelFallbackError(error) {
  const errorText = getGeminiErrorText(error);

  return isRetryableGeminiError(error) || /404|not found|no longer available|deprecated/i.test(errorText);
}

function logGeminiError(error, modelName, attemptNumber, totalAttempts) {
  const innerError = error?.cause || error?.error?.cause;

  console.error('Gemini generateContent error:', {
    model: modelName,
    attempt: `${attemptNumber}/${totalAttempts}`,
    name: error?.name,
    status: getGeminiErrorStatus(error),
    message: error?.message,
    statusText: error?.statusText,
    innerName: innerError?.name,
    innerMessage: innerError?.message,
    innerCode: innerError?.code
  });

  if (/fetch failed/i.test(getGeminiErrorText(error))) {
    console.error('Gemini fetch failed inner error:', innerError || error);
  }
}

async function callGeminiWithRetry(contents, maxRetries = 3) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const totalAttempts = maxRetries + 1;
  let lastError;

  for (let modelIndex = 0; modelIndex < GEMINI_FALLBACK_MODELS.length; modelIndex += 1) {
    const modelName = GEMINI_FALLBACK_MODELS[modelIndex];
    const hasFallbackModel = modelIndex < GEMINI_FALLBACK_MODELS.length - 1;
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: GEMINI_GENERATION_CONFIG
    });

    console.log(`Gemini model selected: ${modelName}`);

    for (let retryCount = 0; retryCount <= maxRetries; retryCount += 1) {
      const attemptNumber = retryCount + 1;

      try {
        console.log(`Gemini generateContent attempt ${attemptNumber}/${totalAttempts} using ${modelName}`);
        return await model.generateContent(contents);
      } catch (error) {
        lastError = error;
        logGeminiError(error, modelName, attemptNumber, totalAttempts);

        if (!isRetryableGeminiError(error)) {
          if (hasFallbackModel && isModelFallbackError(error)) {
            console.warn(`Gemini model ${modelName} failed; falling back to ${GEMINI_FALLBACK_MODELS[modelIndex + 1]}.`);
            break;
          }

          throw error;
        }

        if (retryCount < maxRetries) {
          const delayMs = GEMINI_RETRY_BASE_DELAY_MS * (2 ** retryCount);
          console.warn(`Gemini transient failure on ${modelName}. Retrying in ${delayMs}ms...`);
          await sleep(delayMs);
          continue;
        }

        if (hasFallbackModel) {
          console.warn(`Gemini model ${modelName} failed after ${totalAttempts} attempts; falling back to ${GEMINI_FALLBACK_MODELS[modelIndex + 1]}.`);
          break;
        }
      }
    }
  }

  throw lastError;
}

/**
 * Validates and normalizes the parsed JSON structure returned by Gemini.
 * @param {Object} parsed
 * @returns {Object} Normalized structure
 */
function validateAndNormalizeParsedData(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('LLM output is not a valid JSON object');
  }

  const clientInfo = {
    clientName: String(parsed.clientInfo?.clientName || '').trim(),
    address: String(parsed.clientInfo?.address || '').trim(),
    quotationDate: String(parsed.clientInfo?.quotationDate || '').trim()
  };

  const globalRules = {
    minWeightKg: parsed.globalRules?.minWeightKg != null ? Math.max(0, Number(parsed.globalRules.minWeightKg)) : null,
    fuelSurchargePct: parsed.globalRules?.fuelSurchargePct != null ? Math.max(0, Number(parsed.globalRules.fuelSurchargePct)) : null,
    notes: String(parsed.globalRules?.notes || '').trim()
  };

  const rawRates = Array.isArray(parsed.rates) ? parsed.rates : [];
  const rates = rawRates.map((rate, index) => {
    const rawTargetName = String(rate.targetName || '').trim().toLowerCase();
    let rawTargetType = String(rate.targetType || 'CITY').trim().toUpperCase();

    if (!VALID_TARGET_TYPES.includes(rawTargetType)) {
      rawTargetType = 'CITY';
    }

    const baseKg = rate.baseKg != null ? Math.max(0, Number(rate.baseKg)) : 1;
    const perKgRate = rate.perKgRate != null ? Math.max(0, Number(rate.perKgRate)) : 0;

    return {
      id: index + 1,
      targetName: rawTargetName || 'default',
      targetType: rawTargetType,
      baseKg,
      perKgRate
    };
  });

  return {
    clientInfo,
    globalRules,
    ratesCount: rates.length,
    rates
  };
}

/**
 * Custom wrapper for Multer to handle missing file or upload errors cleanly
 */
function handlePdfUpload(req, res, next) {
  const uploadSingle = upload.single('pdf');
  uploadSingle(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ success: false, error: 'File size exceeds maximum limit of 10MB' });
        }
        return res.status(400).json({ success: false, error: `Upload error: ${err.message}` });
      }
      return res.status(400).json({ success: false, error: err.message });
    }

    // Fallback if field name was 'file' instead of 'pdf'
    if (!req.file && req.files && req.files.length > 0) {
      req.file = req.files[0];
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No PDF file uploaded. Please upload a PDF file in the "pdf" or "file" field.'
      });
    }

    next();
  });
}

/**
 * @route   POST /api/rates/parse-pdf
 * @desc    Parse courier rate card PDF using Gemini AI and return structured JSON
 * @access  Public
 */
router.post('/parse-pdf', handlePdfUpload, async (req, res, next) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    console.log(`GEMINI_API_KEY status: ${apiKey ? 'loaded' : 'missing'}`);

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: 'GEMINI_API_KEY is not configured on the server. Please add GEMINI_API_KEY to your environment variables.'
      });
    }

    const pdfBuffer = req.file.buffer;
    const base64Pdf = pdfBuffer.toString('base64');

    const prompt = `
You are an expert logistics billing auditor. Analyze the attached PDF shipping rate card / quotation document.

Extract the following information into a strictly formatted JSON object:

1. clientInfo:
   - clientName: Name of the shipper / client company
   - address: Client address if present
   - quotationDate: Date of the quote/rate card in YYYY-MM-DD or standard date format

2. globalRules:
   - minWeightKg: Minimum charged weight in KG (e.g. if document states "MINIMUM CHARGE 2KG" or "Min 2 KG", extract 2. Otherwise null)
   - fuelSurchargePct: Fuel surcharge percentage if present (number only, e.g. 15 for 15%), otherwise null
   - notes: Any global terms, special rules, or notes mentioned in the document

3. rates: An array of rate rules for destination targets:
   - targetName: The city, state, custom zone, or region name in lowercase (e.g. "patna", "bihar", "east_india")
   - targetType: Must be EXACTLY one of: ["CITY", "STATE", "CUSTOM_ZONE", "REGION", "DEFAULT"]
     * Use "CITY" for specific cities (e.g. patna, dhanbad, gaya)
     * Use "STATE" for state names (e.g. bihar, jharkhand, assam)
     * Use "CUSTOM_ZONE" for special zones (e.g. bihar_districts, up_east)
     * Use "REGION" for regional clusters (e.g. northeast, south_india, east_india)
     * Use "DEFAULT" for rest-of-India or standard fallback rate
   - baseKg: Minimum or base weight slab in KG (default to 1 if not specified)
   - perKgRate: Numerical rate per kg charged for this destination

Return ONLY valid JSON matching this schema:
{
  "clientInfo": {
    "clientName": "string",
    "address": "string",
    "quotationDate": "string"
  },
  "globalRules": {
    "minWeightKg": 2,
    "fuelSurchargePct": 15,
    "notes": "string"
  },
  "rates": [
    {
      "targetName": "patna",
      "targetType": "CITY",
      "baseKg": 1,
      "perKgRate": 35
    }
  ]
}
`;

    const pdfPart = {
      inlineData: {
        data: base64Pdf,
        mimeType: 'application/pdf'
      }
    };

    let result;
    try {
      result = await callGeminiWithRetry([prompt, pdfPart]);
    } catch (geminiError) {
      console.error('Gemini API call failed after retries and model fallback:', geminiError);
      throw geminiError;
    }
    const response = await result.response;
    const responseText = response.text();

    let parsedJson;
    try {
      // Remove any markdown fencing if returned
      const cleanJsonText = responseText.replace(/```json\s*/gi, '').replace(/```\s*$/gi, '').trim();
      parsedJson = JSON.parse(cleanJsonText);
    } catch (parseError) {
      console.error('Failed to parse Gemini output as JSON:', responseText);
      return res.status(422).json({
        success: false,
        error: 'Failed to parse Gemini LLM response into structured JSON',
        rawOutput: responseText
      });
    }

    const normalizedData = validateAndNormalizeParsedData(parsedJson);

    return res.status(200).json({
      success: true,
      message: 'PDF rate card parsed successfully',
      data: normalizedData
    });

  } catch (error) {
    console.error('Error parsing PDF with Gemini:', error);
    next(error);
  }
});

module.exports = router;
