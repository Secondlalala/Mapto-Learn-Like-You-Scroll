export {};

const nodeRequire = require as (moduleName: string) => {
  readFileSync(path: string, encoding: string): string;
};

const {readFileSync} = nodeRequire('fs');

it('disables react-native-screens activity state restoration', () => {
  const source = readFileSync(
    'android/app/src/main/java/com/secondlalala/maptolearn/MainActivity.kt',
    'utf8',
  );

  expect(source).toContain('import android.os.Bundle');
  expect(source).toMatch(/override fun onCreate\(savedInstanceState: Bundle\?\)/);
  expect(source).toContain('super.onCreate(null)');
});
