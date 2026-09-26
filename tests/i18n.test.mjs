import test from 'node:test';
import assert from 'node:assert/strict';
import { getLang, setLang, onLangChange, t } from '../src/i18n.js';

test('canvas.champ resolves in both languages', () => {
  setLang('tr');
  assert.equal(t('canvas.champ'), 'ŞAMPİYON');
  setLang('en');
  assert.equal(t('canvas.champ'), 'CHAMPION');
  setLang('tr');
});

test('language dispatch terminates when a listener subscribes mid-dispatch', () => {
  // Eski appShell hatasının minyatürü: dinleyici her çağrıda yeni bir
  // dinleyici ekliyordu. `Set.forEach` eklenen girdileri de gezdiğinden bu,
  // anlık kopyasız dağıtımda tek `setLang` çağrısında sonsuz döngüydü.
  let calls = 0;
  const off = onLangChange(() => {
    calls += 1;
    if (calls <= 3) onLangChange(() => {});
  });
  const before = getLang();
  setLang(before === 'tr' ? 'en' : 'tr');
  setLang(before);
  off();
  assert.ok(calls >= 2, 'listener did not run');
});

test('listeners added mid-dispatch run on the next change, not the current one', () => {
  let lateCalls = 0;
  let armed = false;
  const offOuter = onLangChange(() => {
    if (!armed) {
      armed = true;
      onLangChange(() => { lateCalls += 1; });
    }
  });
  const before = getLang();
  setLang(before === 'tr' ? 'en' : 'tr');
  assert.equal(lateCalls, 0);
  setLang(before);
  assert.equal(lateCalls, 1);
  offOuter();
});
