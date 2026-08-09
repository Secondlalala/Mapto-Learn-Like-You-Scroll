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
  const workflowCandidates = [
    path.join(repositoryRoot, '.github/workflows/android-apk.yml'),
    process.env.GITHUB_WORKSPACE
      ? path.join(
          process.env.GITHUB_WORKSPACE,
          's/.github/workflows/android-apk.yml',
        )
      : '',
    process.env.GITHUB_WORKSPACE
      ? path.join(
          process.env.GITHUB_WORKSPACE,
          '.github/workflows/android-apk.yml',
        )
      : '',
  ];
  const workflowPath = workflowCandidates.find(candidate =>
    fs.existsSync(candidate),
  );

  expect(workflowPath).toBeTruthy();
  const workflow = fs.readFileSync(workflowPath!, 'utf8');

  expect(workflow).toContain('assembleRelease');
  expect(workflow).toContain('working-directory: D:\\m');
  expect(workflow).toContain('robocopy');
  expect(workflow).toContain('outputs\\apk\\release\\app-release.apk');
  expect(workflow).toContain('MapToLearn-release-arm64');
  expect(workflow).toContain('apk-output/MapToLearn-release-arm64.apk');
  expect(workflow).toContain('assets/index.android.bundle');
  expect(workflow).toContain('assets/vits-icefall-zh-aishell3/model.onnx');
  expect(workflow).toContain('lib/arm64-v8a/libonnxruntime.so');
  expect(workflow).toContain('lib/arm64-v8a/libsherpa-onnx-jni.so');
  expect(workflow).toContain('assets/licenses/sherpa-onnx-APACHE-2.0.txt');
  expect(workflow).not.toContain('assembleDebug');
});

it('provides a repeatable short-path local APK build', () => {
  const scriptCandidates = [
    path.join(appRoot, '../scripts/build_android_apk.ps1'),
    process.env.GITHUB_WORKSPACE
      ? path.join(
          process.env.GITHUB_WORKSPACE,
          'book-concept-app/scripts/build_android_apk.ps1',
        )
      : '',
    process.env.GITHUB_WORKSPACE
      ? path.join(
          process.env.GITHUB_WORKSPACE,
          's/book-concept-app/scripts/build_android_apk.ps1',
        )
      : '',
  ];
  const scriptPath = scriptCandidates.find(candidate =>
    fs.existsSync(candidate),
  );

  expect(scriptPath).toBeTruthy();
  const script = fs.readFileSync(
    scriptPath!,
    'utf8',
  );

  expect(script).toContain('C:\\mtl-build-');
  expect(script).toContain('assembleRelease');
  expect(script).toContain('apksigner.bat');
  expect(script).toContain('MapToLearn-release-arm64-');
});

it('bundles an ARM64 Mandarin TTS runtime and model without oversized source files', () => {
  const appSource = path.join(appRoot, 'android/app/src/main');
  const modelDir = path.join(appSource, 'assets/vits-icefall-zh-aishell3');
  const model = path.join(modelDir, 'model.onnx');
  const jniDir = path.join(appSource, 'jniLibs/arm64-v8a');

  expect(fs.statSync(model).size).toBeGreaterThan(20 * 1024 * 1024);
  expect(fs.statSync(model).size).toBeLessThan(100 * 1024 * 1024);
  expect(fs.existsSync(path.join(modelDir, 'lexicon.txt'))).toBe(true);
  expect(fs.existsSync(path.join(modelDir, 'phone.fst'))).toBe(true);
  expect(fs.existsSync(path.join(modelDir, 'date.fst'))).toBe(true);
  expect(fs.existsSync(path.join(modelDir, 'number.fst'))).toBe(true);
  expect(fs.existsSync(path.join(modelDir, 'new_heteronym.fst'))).toBe(true);
  expect(fs.existsSync(path.join(jniDir, 'libonnxruntime.so'))).toBe(true);
  expect(fs.existsSync(path.join(jniDir, 'libsherpa-onnx-jni.so'))).toBe(true);

  const gradle = fs.readFileSync(path.join(appRoot, 'android/app/build.gradle'), 'utf8');
  expect(gradle).toContain('abiFilters "arm64-v8a"');
  const rootGradle = fs.readFileSync(path.join(appRoot, 'android/build.gradle'), 'utf8');
  expect(rootGradle).toContain('minSdkVersion = 29');
});
