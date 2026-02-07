# Pricing Page Screenshot PDF Service

Web-only self-hosted сервис по спецификации `spec-pricing-screenshots-v1-ru.md`.

## Что делает

- Принимает `user_id` и список доменов через запятую.
- Дедуплицирует домены, обрабатывает до 10 уникальных доменов.
- Ищет pricing-страницу через `https://<domain>/pricing` с fallback на `http://<domain>/pricing`.
- Снимает 4 скриншота (desktop/mobile viewport + full-page).
- Формирует PDF в памяти: `1 домен = 1 страница`.
- Не хранит скриншоты и PDF на сервере.
- Пишет аналитические логи запусков (`user_id`, `domains[]`, `domains_count`, `pdf_status` и пр.) с retention 90 дней.

## Быстрый старт

```bash
npm install
npx playwright install chromium
npm start
```

Открыть в браузере: [http://localhost:3000](http://localhost:3000)

## Основные API

- `POST /api/runs` — создать запуск
- `GET /api/runs/:runId/status` — статус и прогресс
- `GET /api/runs/:runId/download` — скачать PDF
- `GET /api/analytics/summary` — агрегированная аналитика
- `GET /api/analytics/runs` — список запусков

## Примечания

- Логи хранятся в `data/analytics.ndjson`.
- Запуски и PDF-хранилище в runtime — в памяти процесса.
- Run автоматически удаляется из памяти через ~20 минут после завершения.
