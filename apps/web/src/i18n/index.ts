import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ru from './ru';
import uz from './uz';

const saved = (() => {
  try {
    return localStorage.getItem('lang');
  } catch {
    return null;
  }
})();

void i18n.use(initReactI18next).init({
  resources: { uz: { translation: uz }, ru: { translation: ru } },
  lng: saved === 'ru' ? 'ru' : 'uz',
  fallbackLng: 'uz',
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (l) => {
  document.documentElement.lang = l;
  try {
    localStorage.setItem('lang', l);
  } catch {
    /* brauzer xotirasi yopiq */
  }
});

export default i18n;
