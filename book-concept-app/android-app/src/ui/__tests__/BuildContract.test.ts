import fs from 'fs';
import path from 'path';

const appRoot = path.resolve(__dirname, '../../..');
const repositoryRoot = path.resolve(appRoot, '../..');

it('registers the React component from src instead of resolving app.json', () => {
  const entryPoint = fs.readFileSync(path.join(appRoot, 'index.js'), 'utf8');

  expect(entryPoint).toContain("import App from './src/App'");
  expect(entryPoint).not.toContain("import App from './App'");
});

it('builds and uploads a standalone ARM64 release APK', () => {
  const workflow = fs.readFileSync(
    path.join(repositoryRoot, '.github/workflows/android-apk.yml'),
    'utf8',
  );

  expect(workflow).toContain('assembleRelease');
  expect(workflow).toContain('outputs\\apk\\release\\app-release.apk');
  expect(workflow).toContain('MapToLearn-release-arm64');
  expect(workflow).toContain('assets/index.android.bundle');
  expect(workflow).not.toContain('assembleDebug');
});
