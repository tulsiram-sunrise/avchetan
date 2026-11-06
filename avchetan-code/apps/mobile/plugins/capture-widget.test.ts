import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { addKeepIntent, addReceiver, addRefresh, widgetFiles } = require('./capture-widget.js');

const app = { packageName: 'app.avchetan', scheme: 'avchetan' };

describe('capture widget plugin', () => {
  it('writes the provider, its layout, info and colours for light, dark and Android 12', () => {
    const files: Record<string, string> = widgetFiles(app);

    expect(Object.keys(files).sort()).toEqual([
      'java/app/avchetan/widget/CaptureWidgetProvider.kt',
      'res/drawable/capture_widget_background.xml',
      'res/layout/capture_widget.xml',
      'res/values-night-v31/capture_widget.xml',
      'res/values-night/capture_widget.xml',
      'res/values-v31/capture_widget.xml',
      'res/values/capture_widget.xml',
      'res/xml/capture_widget_info.xml',
    ]);
    const provider = files['java/app/avchetan/widget/CaptureWidgetProvider.kt'];
    expect(provider).toContain('package app.avchetan.widget');
    expect(provider).toContain('import app.avchetan.R');
    expect(provider).toContain('"avchetan://capture?from=widget"');
    for (const name of ['background', 'hint', 'accent']) {
      for (const values of ['values', 'values-night', 'values-v31', 'values-night-v31']) {
        expect(files[`res/${values}/capture_widget.xml`]).toContain(`capture_widget_${name}"`);
      }
    }
    expect(files['res/values/capture_widget.xml']).toContain("What\\'s on your mind?");
  });

  it('adds the receiver once, however often prebuild runs', () => {
    const manifest = { manifest: { application: [{ $: { 'android:name': '.MainApplication' } }] } };

    addReceiver(manifest, app.packageName);
    addReceiver(manifest, app.packageName);

    const receivers = manifest.manifest.application[0].receiver;
    expect(receivers).toHaveLength(1);
    expect(receivers[0].$['android:name']).toBe('app.avchetan.widget.CaptureWidgetProvider');
    expect(receivers[0]['meta-data'][0].$['android:resource']).toBe('@xml/capture_widget_info');
  });

  it('refreshes the widget when the app starts, once', () => {
    const main =
      'class MainApplication {\n  override fun onCreate() {\n    super.onCreate()\n  }\n}';

    const once = addRefresh(main, app.packageName);

    expect(addRefresh(once, app.packageName)).toBe(once);
    expect(once).toContain(
      'super.onCreate()\n    app.avchetan.widget.CaptureWidgetProvider.refresh(this)',
    );
  });

  it('makes MainActivity keep the widget link that wakes a killed app, once', () => {
    const main =
      'package app.avchetan\n\nimport android.os.Bundle\n\nclass MainActivity {\n  override fun getMainComponentName(): String = "main"\n}';

    const once = addKeepIntent(main);

    expect(addKeepIntent(once)).toBe(once);
    expect(once).toContain('package app.avchetan\n\nimport android.content.Intent\n');
    expect(once).toMatch(/setIntent\(intent\)\n\s+super\.onNewIntent\(intent\)/);
    expect(once.indexOf('onNewIntent')).toBeLessThan(once.indexOf('getMainComponentName'));
  });
});
