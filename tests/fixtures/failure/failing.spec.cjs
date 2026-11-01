// Deliberately failing fixture, discovered only by the exit-status contract test.
const { test, expect } = require('@playwright/test');
test('intentional assertion failure', () => expect('actual').toBe('expected'));
