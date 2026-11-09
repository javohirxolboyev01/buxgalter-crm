// Mavzu sahifa chizilishidan oldin qo'yiladi (oq chaqnash bo'lmasin); asosiy mantiq src/lib/theme.ts.
// Alohida fayl: prod'da helmet CSP inline <script>ni bloklaydi.
try {
  var t = localStorage.getItem('theme');
  if (t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches))
    document.documentElement.classList.add('dark');
} catch (e) {}
