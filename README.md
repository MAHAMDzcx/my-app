# Quran Radio Discord Bot

## Termux setup

```bash
pkg update -y
pkg install nodejs ffmpeg -y
cp .env.example .env
nano .env
npm install
npm start
```

ضع توكن البوت داخل `.env` فقط:

```env
TOKEN=توكن_البوت
```

ثم استخدم في Discord:

- `/join` لدخول القناة وتشغيل البث
- `/quran` لتغيير الإذاعة
- `/status` لعرض الحالة
- `/stop` لإيقاف البث

صلاحيات البوت المطلوبة: View Channel وConnect وSpeak.
