// Vite'in derleme zamanında enjekte ettiği globals (`vite.config.js` → define).
// Kaynakta tanım arayan `tsc --checkJs` buradan okur; runtime'da değer üretmez.

declare const __APP_VERSION__: string;
