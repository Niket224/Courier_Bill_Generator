export function testEnvironment(source = process.env) {
  const env = Object.fromEntries(Object.entries(source).filter(([key]) =>
    /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|COMSPEC)$/i.test(key)));
  return { ...env, NODE_ENV: 'test', TEST_DB_MODE: 'memory' };
}
