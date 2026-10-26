# Посещаемость

Сайт для отметки присутствия студентов. Файлы сайта лежат на GitHub Pages, данные — в Firebase (Firestore), вход через Google. Записывать и читать данные может только владелец.

## 1. Firebase (один раз)

1. https://console.firebase.google.com → «Add project» (аналитику можно отключить).
2. Build → **Authentication** → Get started → Sign-in method → **Google** → Enable.
3. Build → **Firestore Database** → Create database (режим production, любой ближайший регион).
4. Вкладка **Rules** → вставить содержимое `firestore.rules` (внутри замените почту на свою) → Publish.
5. Project settings (шестерёнка) → Your apps → значок `</>` (Web) → зарегистрировать приложение → скопировать объект `firebaseConfig`.
6. Вставить его в `firebase-config.js`: `window.FIREBASE_CONFIG = { ... };`
7. Authentication → Settings → **Authorized domains** → добавить `ВАШ_ЛОГИН.github.io`.

Ключи в `firebase-config.js` не секретные (так устроен Firebase), защита — в правилах из пункта 4.

## 2. GitHub

1. Создать репозиторий, загрузить файлы (без резервных копий `.json` — они в `.gitignore`).
2. Settings → Pages → Branch: `main`, папка `/ (root)` → Save.
3. Включить двухфакторную защиту на аккаунте GitHub и **не добавлять соавторов** в Settings → Collaborators. Тогда править код сможете только вы.
4. По желанию: Settings → Branches → защитить ветку `main`.

Данные в Firestore разбиты по месяцам: документ `attendance/meta` (список студентов) и по одному документу `attendance/m_ГГГГ-ММ` на каждый месяц. Так ни один документ не приближается к лимиту в 1 МБ.

Имена студентов в репозиторий **не попадают**: они вводятся на сайте и хранятся в Firestore.
