const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = process.cwd();
const adapterPath = path.join(root, 'services', 'seasonDatePickerCapability.ts');
const managerSource = fs.readFileSync(path.join(root, 'components', 'SquadSeasonManager.tsx'), 'utf8');
const routeSource = fs.readFileSync(path.join(root, 'app', '(social)', 'squad-detail.tsx'), 'utf8');
const translations = fs.readFileSync(path.join(root, 'i18n', 'index.ts'), 'utf8');

function transpile(filePath) {
  return ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}

function executeModule(filePath, requireModule) {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', '__DEV__', transpile(filePath))(
    requireModule,
    module,
    module.exports,
    true,
  );
  return module.exports;
}

function createModuleStub() {
  const base = () => null;
  const stub = new Proxy(base, {
    get(_target, property) {
      if (property === '__esModule') return true;
      if (property === 'default') return stub;
      if (property === 'StyleSheet') return { create: (styles) => styles };
      if (property === 'Platform') return { OS: 'android' };
      return stub;
    },
  });
  return stub;
}

function importSquadRoute(adapterExports) {
  const stub = createModuleStub();
  const managerExports = executeModule(
    path.join(root, 'components', 'SquadSeasonManager.tsx'),
    (request) => request === '@/services/seasonDatePickerCapability' ? adapterExports : stub,
  );
  assert.equal(typeof managerExports.SquadSeasonManager, 'function');
  return executeModule(
    path.join(root, 'app', '(social)', 'squad-detail.tsx'),
    (request) => request === '@/components/SquadSeasonManager' ? managerExports : stub,
  );
}

function executeAdapter(requireModule) {
  const output = transpile(adapterPath);
  const module = { exports: {} };
  const diagnostics = [];
  new Function('require', 'module', 'exports', '__DEV__', 'console', output)(
    (request) => request === 'react-native' ? { Platform: { OS: 'android' } } : requireModule(request),
    module,
    module.exports,
    true,
    { info: (...args) => diagnostics.push(args) },
  );
  return { exports: module.exports, diagnostics };
}

const unavailable = executeAdapter(() => {
  throw new Error("TurboModuleRegistry: 'RNCDatePicker' could not be found");
});
assert.equal(unavailable.exports.getSeasonDatePickerAvailability(), 'unchecked');
assert.deepEqual(unavailable.exports.getSeasonDatePickerCapability(), {
  status: 'unavailable',
  issue: 'missing-native-module',
});
assert.equal(unavailable.exports.getSeasonDatePickerAvailability(), 'missing-native-module');
assert.equal(unavailable.diagnostics.length, 1, 'missing native capability is diagnosed once without user data');
assert.equal(typeof importSquadRoute(unavailable.exports).default, 'function', 'Squad Detail imports without the native picker');

const Picker = () => null;
const androidApi = { open() {} };
const available = executeAdapter(() => ({ default: Picker, DateTimePickerAndroid: androidApi }));
assert.equal(available.exports.getSeasonDatePickerCapability().capability.Picker, Picker);
assert.equal(available.exports.getSeasonDatePickerCapability().capability.androidApi, androidApi);
assert.equal(available.exports.getSeasonDatePickerAvailability(), 'available');
assert.deepEqual(
  {
    hasAndroidApi: available.diagnostics[0][1].hasAndroidApi,
    hasAndroidOpen: available.diagnostics[0][1].hasAndroidOpen,
    packageLoaded: available.diagnostics[0][1].packageLoaded,
    platform: available.diagnostics[0][1].platform,
  },
  { hasAndroidApi: true, hasAndroidOpen: true, packageLoaded: true, platform: 'android' },
);
assert.equal(typeof importSquadRoute(available.exports).default, 'function', 'Squad Detail imports with the native picker');

const directExport = executeAdapter(() => Picker);
assert.equal(directExport.exports.getSeasonDatePickerCapability().capability.Picker, Picker, 'CommonJS direct exports are normalized');

const ObjectPicker = { $$typeof: Symbol.for('react.forward_ref'), render() { return null; } };
const objectExport = executeAdapter(() => ({ default: ObjectPicker, DateTimePickerAndroid: androidApi }));
assert.equal(objectExport.exports.getSeasonDatePickerCapability().capability.Picker, ObjectPicker, 'object-shaped React components remain valid');

const unrelatedImportFailure = executeAdapter(() => { throw new TypeError('Unexpected JavaScript failure'); });
assert.equal(unrelatedImportFailure.exports.getSeasonDatePickerCapability().issue, 'calendar-error');

let selectedDate = null;
let dismissed = 0;
let capturedProps = null;
const invocation = executeAdapter(() => ({
  default: ObjectPicker,
  DateTimePickerAndroid: { open: (props) => { capturedProps = props; } },
}));
const invocationCapability = invocation.exports.getSeasonDatePickerCapability().capability;
assert.equal(invocation.exports.openSeasonAndroidDatePicker({
  capability: invocationCapability,
  onDismiss: () => { dismissed += 1; },
  onFailure: () => assert.fail('successful invocation must not fail'),
  onSet: (date) => { selectedDate = date; },
  value: new Date(2026, 8, 1),
}), true);
assert.equal(typeof capturedProps.onChange, 'function');
const picked = new Date(2026, 8, 8);
capturedProps.onChange({ type: 'set' }, picked);
assert.equal(selectedDate, picked, 'Android selection returns the confirmed date');
capturedProps.onChange({ type: 'dismissed' }, new Date(2026, 8, 10));
assert.equal(dismissed, 1, 'Android dismissal does not confirm a different date');

let missingApiIssue = null;
assert.equal(invocation.exports.openSeasonAndroidDatePicker({
  capability: { Picker: ObjectPicker, androidApi: null },
  onDismiss() {},
  onFailure: (issue) => { missingApiIssue = issue; },
  onSet() {},
  value: new Date(),
}), false);
assert.equal(missingApiIssue, 'calendar-error', 'a missing Android API is not mislabeled as an old build');

const thrownInvocation = executeAdapter(() => ({
  default: ObjectPicker,
  DateTimePickerAndroid: { open: () => { throw new TypeError('Bad date argument'); } },
}));
let thrownIssue = null;
thrownInvocation.exports.openSeasonAndroidDatePicker({
  capability: thrownInvocation.exports.getSeasonDatePickerCapability().capability,
  onDismiss() {},
  onFailure: (issue) => { thrownIssue = issue; },
  onSet() {},
  value: new Date(),
});
assert.equal(thrownIssue, 'calendar-error', 'unrelated invocation errors use the generic calendar fallback');

const missingNativeInvocation = executeAdapter(() => ({
  default: ObjectPicker,
  DateTimePickerAndroid: { open: (props) => props.onError(new Error("TurboModuleRegistry: 'RNCDatePicker' could not be found")) },
}));
let missingNativeIssue = null;
assert.equal(missingNativeInvocation.exports.openSeasonAndroidDatePicker({
  capability: missingNativeInvocation.exports.getSeasonDatePickerCapability().capability,
  onDismiss() {},
  onFailure: (issue) => { missingNativeIssue = issue; },
  onSet() {},
  value: new Date(),
}), false);
assert.equal(missingNativeIssue, 'missing-native-module', 'only a confirmed missing native module uses the build-required fallback');

assert.match(routeSource, /export default function SquadDetailScreen\s*\(/, 'Squad Detail keeps one valid default route component');
assert.equal((routeSource.match(/export default/g) ?? []).length, 1);
assert.doesNotMatch(managerSource, /from ["']@react-native-community\/datetimepicker["']/, 'route imports do not evaluate the native picker');
assert.doesNotMatch(fs.readFileSync(adapterPath, 'utf8'), /NativeModules\./, 'NativeModules presence is not used as a capability pre-check');
assert.match(managerSource, /getSeasonDatePickerCapability\(\)/);
assert.match(managerSource, /loadResult\.status === "unavailable"/);
assert.match(managerSource, /calendarBuildRequired/);
assert.match(managerSource, /calendarOpenError/);
assert.match(managerSource, /if \(pickerField \|\| saving \|\| androidPickerOpenRef\.current\) return;/);
assert.ok(
  managerSource.indexOf('androidPickerOpenRef.current = true') < managerSource.indexOf('openSeasonAndroidDatePicker({'),
  'the synchronous guard is acquired before Android open, preventing duplicate dialogs',
);
assert.match(managerSource, /openSeasonAndroidDatePicker/);
assert.match(managerSource, /pickerField !== null && DateTimePicker !== null/);
assert.match(translations, /This development build does not include the calendar yet\./);
assert.match(translations, /Esta versión de desarrollo todavía no incluye el calendario\./);
assert.match(translations, /The calendar couldn’t open\. Please try again\./);
assert.match(translations, /No se pudo abrir el calendario\. Inténtalo de nuevo\./);
assert.doesNotMatch(translations, /RNCDatePicker|TurboModuleRegistry|@react-native-community\/datetimepicker/);

console.log('Season picker package shape, classified fallback, Android API, dismissal, iOS component, and route compatibility tests passed.');
