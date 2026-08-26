# Инструкция по разработке и запуску

---

## 📋 Требования к окружению

- **Node.js**: `v20+` (рекомендуется `v22.x`)
- **npm**: `v10+`
- **ОС**: Ubuntu Linux (X11 / Wayland), Windows 10/11, macOS

---

## 🚀 Установка зависимостей

```bash
npm install
```

---

## 💻 Команды разработки

### Запуск в режиме разработки (Dev Server + Electron HMR)

```bash
npm run dev
```

### Запуск тестов (Vitest)

```bash
npm test
```

### Запуск тестов в режиме наблюдения (Watch Mode)

```bash
npx vitest
```

---

## 🔍 Проверка типов (TypeScript Strict Mode)

### Полная проверка всех процессов:

```bash
npm run typecheck
```

### Проверка Node-процессов (Main, Preload, Configs, Infrastructure):

```bash
npm run typecheck:node
```

### Проверка Web-процесса (React Renderer UI):

```bash
npm run typecheck:web
```

---

## 📦 Сборка проекта (Production Build)

Сборка бандлов приложения (Renderer в `dist/`, Electron Main & Preload в `dist-electron/`):

```bash
npm run build
```

---

## 🧹 Очистка артефактов сборки

```bash
npm run clean
```
