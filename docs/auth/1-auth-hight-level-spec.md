# Спецификация: система авторизации и управления доступом

**Документ 1 из 2 — высокоуровневая спецификация**

Этот документ описывает архитектурные решения и модель данных. Он не содержит примеров кода, описаний middleware или конкретных API-эндпоинтов — это будет в Документе 2 (подробная спецификация).

---

## 1. Контекст и цели

### 1.1. Что мы делаем

Текущий форк проекта (на базе Adorable, с заменой проприетарных компонентов Freestyle на open source — Gitea для git, Vite-builder вместо VM-сэндбоксов, Caddy для раздачи статики) — это однопользовательское приложение. Вся работа ведётся под одним юзером, без концепции владения, без разграничения доступа, без биллинга.

Цель этой спецификации — превратить форк в multi-tenant SaaS-платформу по модели Lovable Teams и Base44. Юзеры регистрируются, создают свои проекты, могут приглашать других участников с разными ролями, публиковать приложения с настраиваемой видимостью, потреблять платные ресурсы (LLM-вызовы, генерацию изображений, STT, TTS) в рамках лимитов своего тарифа.

### 1.2. Что важно сделать сейчас

Цель этой первой спеки — **внедрение авторизации и фундамента для multi-tenancy**. Это включает:

- Регистрацию и вход юзеров (email+пароль, OAuth через Google, Яндекс, VK).
- Слой организаций над проектами с автоматической персональной организацией для каждого юзера.
- Систему ролей и пермишенов, общую для юзеров и для бэк-офиса.
- Структуру биллинга и лимитов как заглушку (структура полная, реализация платежей — позже).
- Структуру публикации с тремя уровнями видимости.
- API-токены проекта для будущей интеграции с экспортом и data backend.
- Аудит-лог для отслеживания значимых действий.

### 1.3. Что осознанно оставлено на потом

Эти вещи не реализуются в текущей спеке, но **структура для них в схеме закладывается сразу**, чтобы потом не делать болезненные миграции:

- Приглашения участников в проект (UI и flow).
- Реферальная программа (логика бонусов).
- Кастомные домены пользователей (привязка через CNAME).
- Telegram и Max как OAuth-провайдеры.
- Выход из организации.
- Полноценная админка с UI.

### 1.4. Что вне этой спеки полностью

Эти темы обсуждались по ходу проектирования и зафиксированы в Разделе 13, но в текущей спеке не реализуются и в схеме не отражаются (либо отражаются минимально):

- Версионирование проекта и снапшоты (откат кода и чата).
- Структура чата и сообщений с AI.
- Билд-воркеры, очереди, генерация превью.
- Хранилище данных приложения (Appwrite или своё) и юзеры опубликованных приложений.
- Голос (STT/TTS), модерация, ratelimiting, медиа-ассеты.

---

## 2. Модель домена

### 2.1. Юзер платформы

Юзер — это человек, зарегистрированный в системе. Один человек = одна запись `users`. К одной записи юзера может быть привязано несколько способов входа: email с паролем, аккаунт в Google, аккаунт в Яндекс, аккаунт в VK. Эти способы хранятся в отдельной таблице `accounts`, по одной записи на каждый провайдер.

При регистрации через email обязательно подтверждение почты по ссылке. Юзер с неподтверждённым email имеет ограниченный доступ — не может создавать проекты, не может пользоваться публичными опубликованными приложениями уровня "только для зарегистрированных".

Слияние аккаунтов — строгое. Если юзер зарегался через email vasya@gmail.com, и потом пытается войти через Google с тем же email — система не объединяет автоматически. Вместо этого выдаёт ошибку "аккаунт с таким email уже существует, войдите старым способом и привяжите Google в настройках". Это пресекает абьюз через создание дубликатов.

Email при сохранении нормализуется агрессивно: для gmail-адресов точки игнорируются, плюс-алиасы (vasya+test@gmail.com) приводятся к базовой форме. Это не даёт обойти проверку уникальности через варианты одного и того же ящика.

### 2.2. Организация

Организация — это контейнер для проектов и единица биллинга. Каждый юзер при регистрации автоматически получает **персональную организацию** (тип `personal`). Личные проекты юзера живут в ней. Юзер может создать дополнительные организации типа `team` и пригласить туда других людей — это команда с общим биллингом и общими проектами.

Каждая организация имеет свою подписку, свои лимиты, свой usage. Один юзер может состоять в нескольких организациях с разными планами одновременно (например, в личной организации план free, в командной — план pro).

В первой версии **выход из организации не реализуется** — это слишком большая фича (что делать если юзер был owner, что с его проектами и т.д.). Юзера можно только удалить через owner-а или через админку.

### 2.3. Проект

Проект — это AI-генерируемое приложение. У каждого проекта есть:

- Привязка к Gitea-репозиторию (один сервисный Gitea-юзер владеет всеми репо в системе).
- Slug для построения preview-поддомена (генерируется из названия при создании, может быть отредактирован вручную, после первой публикации фиксируется).
- Memory как редактируемый markdown-документ — короткое описание архитектурных решений проекта, подаётся в системный промпт LLM.
- Состояние публикации (см. Раздел 7).
- Конфигурация data backend (см. Раздел 8.4).

Проект всегда принадлежит организации, не юзеру напрямую. Юзер-создатель — owner проекта по факту создания, но это просто роль, а не владение.

### 2.4. Роль и пермишен

**Роль** — именованный набор пермишенов. Роли хранятся в общем справочнике `roles` с полем `scope`, которое определяет где роль применима: `organization`, `project` или `admin`.

**Пермишен** — атомарное право на действие в системе (например, `project.edit`, `project.publish`, `admin.users.ban`).

Связь между ролями и пермишенами — таблица `role_permissions`. Это даёт гибкость: добавить новую роль или изменить набор её прав можно вставкой/правкой строк в БД, без изменения кода и без миграции схемы.

Базовый набор ролей:

| Scope | Slug | Описание |
|-------|------|----------|
| organization | owner | Создатель организации, полные права |
| organization | admin | Может управлять участниками и проектами, не может удалить организацию |
| organization | member | Участник, права на проекты — через project-роли |
| project | viewer | Только чтение кода и превью |
| project | editor | Чтение + чат с AI, редактирование кода и данных приложения |
| project | publisher | Editor + деплой, изменение схемы и функций приложения, привязка доменов |
| project | owner | Publisher + управление участниками проекта, удаление проекта |
| admin | superadmin | Все админские права |
| admin | support | Просмотр юзеров, организаций, помощь по тикетам |
| admin | finance | Просмотр и редактирование планов, подписок, override-ов лимитов |
| admin | content | Модерация публикаций (на будущее) |

### 2.5. Членство

Членство — факт того, что юзер имеет роль в каком-то контексте. У нас три отдельных таблицы членства:

- `organization_members` — членство в организации.
- `project_members` — членство в проекте (опционально, поверх org-членства).
- `admin_role_assignments` — назначение админских ролей глобально.

Эти таблицы разделены, потому что у них разная семантика и разные внешние ключи. Объединение в одну универсальную таблицу с полем `scope_type` сломало бы ссылочную целостность.

### 2.6. Эффективная роль на проекте

Юзер получает доступ к проекту двумя путями:

1. Он состоит в организации, которой принадлежит проект (через `organization_members`).
2. Он явно добавлен в `project_members` с конкретной ролью.

**Эффективная роль на проекте** = максимум по правам между:

- Дефолтной project-ролью, выводимой из его org-роли (например, org-owner получает project-owner на всех проектах своей организации; org-admin получает project-publisher; org-member получает project-viewer).
- Явно назначенной project-ролью из `project_members`, если она есть.

Это значит: юзер из организации всегда видит её проекты с минимальным дефолтным уровнем доступа. Если ему нужно больше прав на конкретный проект — owner добавляет запись в `project_members` с повышенной ролью. Понизить ниже org-дефолта через project-роль нельзя.

Маппинг org-роль → дефолтная project-роль хранится не в коде, а в данных (например, как поле в самой таблице `roles` или отдельная справочная таблица). Это позволяет менять политику без релизов.

### 2.7. Подписка и лимиты

У каждой организации есть **активная подписка** — связь с одним из планов. План определяет лимиты на потребление платных ресурсов. Лимиты хранятся в плане как JSON-структура с произвольными ключами (например, `llm.tokens.monthly`, `image.generations.monthly`, `stt.minutes.monthly`, `tts.chars.monthly`, `projects.max`, `members_per_project.max`).

При создании юзера и его персональной организации автоматически активируется план **free** — это и есть trial. Никакого отдельного механизма trial нет, free-план просто настраивается с маленькими стартовыми лимитами и обнуляется ежемесячно.

Помимо плана, для конкретной организации можно завести **override** на лимиты — индивидуальные значения, которые перекрывают план. Это нужно для бесплатного увеличения квот ранним пользователям, для VIP-клиентов, для саппорта в случае проблем. Override хранится в отдельной таблице, чтобы не мешать редактированию самого плана.

Все списания идут с организации, но в `usage_events` фиксируется и `user_id` — кто конкретно сделал вызов. Это позволяет показать статистику внутри команды.

Лимиты **препейд** — перед потенциально дорогим действием проверяется остаток квоты. Если квоты нет — действие отклоняется с понятной ошибкой. Это единообразное поведение для всех платных операций.

### 2.8. Публикация

Публикация — это процесс, при котором текущее состояние проекта (или указанная версия) становится доступным по URL. У проекта может быть только одна актуальная публикация — при следующем publish предыдущая версия перетирается.

У публикации три уровня видимости:

- `private` — видят только участники проекта.
- `authenticated` — видят все юзеры платформы с подтверждённым email.
- `public` — видят все, включая незалогиненных.

Публикация фиксирует:

- На какой snapshot/коммит она ссылается (см. Раздел 13 про снапшоты — таблица заводится как минимальная заглушка).
- Когда была опубликована.
- На каком поддомене (или кастомном домене) доступна.

### 2.9. API-токен проекта

У проекта может быть несколько API-токенов с разным назначением:

- `public` — для использования в публичном фронтенде, ограниченные права.
- `server` — для серверной интеграции, полные права на данные приложения.
- `export` — для запущенного локально экспортированного кода юзера.

Токены хранятся в отдельной таблице `project_tokens`, не в самой `projects`, чтобы можно было иметь несколько токенов на проект, ротировать их, отзывать без удаления, отслеживать `last_used_at`.

Сами значения токенов хранятся в БД как хеш — после генерации показываются юзеру один раз и больше не восстанавливаются.

### 2.10. Аудит-лог

Все значимые действия в системе пишутся в `audit_log`: регистрация, вход, изменение роли, добавление/удаление участника, публикация, изменение плана, бан юзера, изменение лимитов через override, удаление проекта.

Запись содержит: кто сделал действие (`actor_user_id`), что сделал (`action`), над каким объектом (`target_type`, `target_id`), детали (`metadata` JSON), время.

Аудит-лог — append-only. Записи не редактируются и не удаляются.

---

## 3. Схема базы данных

Все таблицы — Postgres, ORM — Drizzle (как в Adorable). Имена таблиц во множественном числе, snake_case. Первичные ключи — UUID v7 (хронологически сортируемые), кроме справочников.

### 3.1. Auth-слой (Better Auth-совместимый)

```
users
  id                uuid PK
  email             text unique not null            -- нормализованный
  email_verified    boolean default false
  email_raw         text                            -- то, как ввёл юзер
  password_hash     text                            -- nullable, если только OAuth
  name              text
  avatar_url        text
  is_admin          boolean default false           -- быстрый флаг для проверки
  status            text default 'active'           -- 'active' | 'suspended' | 'deleted'
  referrer_id       uuid references users(id)      -- кто пригласил (заглушка)
  referral_code     text unique                     -- свой код (заглушка)
  created_at        timestamptz default now()
  updated_at        timestamptz default now()

accounts
  id                  uuid PK
  user_id             uuid not null references users(id) on delete cascade
  provider            text not null                 -- 'email' | 'google' | 'yandex' | 'vk'
  provider_account_id text not null                 -- email для 'email', sub для OAuth
  access_token        text
  refresh_token       text
  expires_at          timestamptz
  created_at          timestamptz default now()
  unique(provider, provider_account_id)

sessions
  id            uuid PK
  user_id       uuid not null references users(id) on delete cascade
  token_hash    text unique not null
  expires_at    timestamptz not null
  user_agent    text
  ip_address    inet
  created_at    timestamptz default now()

verification_tokens
  id          uuid PK
  user_id     uuid references users(id) on delete cascade
  type        text not null                          -- 'email_verify' | 'password_reset'
  token_hash  text unique not null
  expires_at  timestamptz not null
  used_at     timestamptz
  created_at  timestamptz default now()
```

### 3.2. Слой ролей и пермишенов

```
roles
  id                          uuid PK
  scope                       text not null         -- 'organization' | 'project' | 'admin'
  slug                        text not null         -- 'owner' | 'editor' | 'support' и т.д.
  name                        text not null
  description                 text
  is_system                   boolean default true  -- системные нельзя удалить через админку
  default_project_role_id     uuid references roles(id)
                                                    -- только для scope='organization';
                                                    -- какая project-роль выводится из этой org-роли
  created_at                  timestamptz default now()
  unique(scope, slug)

permissions
  id           uuid PK
  slug         text unique not null                 -- 'project.edit', 'admin.users.ban' и т.д.
  scope_hint   text                                 -- для UI группировки: 'project' | 'organization' | 'admin'
  name         text not null
  description  text

role_permissions
  role_id        uuid not null references roles(id) on delete cascade
  permission_id  uuid not null references permissions(id) on delete cascade
  primary key (role_id, permission_id)
```

### 3.3. Организации и членство

```
organizations
  id            uuid PK
  type          text not null                       -- 'personal' | 'team'
  slug          text unique not null                -- для URL
  name          text not null
  owner_user_id uuid not null references users(id)
  created_at    timestamptz default now()
  updated_at    timestamptz default now()
  -- biling-related fields см. в 3.5

organization_members
  organization_id uuid not null references organizations(id) on delete cascade
  user_id         uuid not null references users(id) on delete cascade
  role_id         uuid not null references roles(id)
                                                    -- должна быть scope='organization'
  joined_at       timestamptz default now()
  primary key (organization_id, user_id)

admin_role_assignments
  id           uuid PK
  user_id      uuid not null references users(id) on delete cascade
  role_id      uuid not null references roles(id)
                                                    -- должна быть scope='admin'
  granted_by   uuid references users(id)
  granted_at   timestamptz default now()
  expires_at   timestamptz                          -- опционально, для временных доступов
  unique(user_id, role_id)
```

### 3.4. Проекты и членство в проекте

```
projects
  id                       uuid PK
  organization_id          uuid not null references organizations(id) on delete cascade
  slug                     text not null                     -- уникален в рамках org
  name                     text not null
  description              text
  gitea_repo_id            bigint                            -- id репо в Gitea
  gitea_repo_name          text                              -- имя репо в Gitea
  preview_subdomain        text unique                       -- финальный поддомен
  preview_subdomain_locked boolean default false             -- зафиксирован после первой публикации
  memory                   text default ''                   -- markdown с архитектурными заметками
  data_backend             jsonb                             -- конфигурация data backend (см. 2.3)
  status                   text default 'active'             -- 'active' | 'archived' | 'deleted'
  created_by_user_id       uuid not null references users(id)
  created_at               timestamptz default now()
  updated_at               timestamptz default now()
  archived_at              timestamptz
  unique(organization_id, slug)
  -- publication-related fields см. в 3.7

project_members
  project_id  uuid not null references projects(id) on delete cascade
  user_id     uuid not null references users(id) on delete cascade
  role_id     uuid not null references roles(id)            -- scope='project'
  invited_by  uuid references users(id)
  joined_at   timestamptz default now()
  primary key (project_id, user_id)
```

### 3.5. Биллинг

```
plans
  id                  uuid PK
  slug                text unique not null            -- 'free' | 'pro' | 'team' | ...
  name                text not null
  description         text
  monthly_price_cents integer not null default 0
  currency            text default 'USD'
  limits              jsonb not null                  -- { "llm.tokens.monthly": 100000, ... }
  features            jsonb                           -- { "custom_domains": true, ... }
  is_public           boolean default true            -- показывать на странице цен
  is_active           boolean default true            -- доступен ли для подписки
  sort_order          integer default 0
  created_at          timestamptz default now()
  updated_at          timestamptz default now()

subscriptions
  id                    uuid PK
  organization_id       uuid not null references organizations(id) on delete cascade
  plan_id               uuid not null references plans(id)
  status                text not null              -- 'active' | 'past_due' | 'canceled' | 'expired'
  current_period_start  timestamptz not null
  current_period_end    timestamptz not null
  provider              text                       -- 'manual' | 'stripe' | 'yookassa' (на будущее)
  provider_subscription_id text
  cancel_at_period_end  boolean default false
  created_at            timestamptz default now()
  updated_at            timestamptz default now()

plan_overrides
  id              uuid PK
  organization_id uuid not null references organizations(id) on delete cascade
  limits          jsonb not null                   -- частичный override, мерджится поверх plan.limits
  reason          text                             -- почему выдан override
  granted_by      uuid references users(id)
  expires_at      timestamptz                      -- nullable = бессрочно
  created_at      timestamptz default now()

usage_events
  id              uuid PK                          -- UUID v7 для хронологической сортировки
  organization_id uuid not null references organizations(id) on delete cascade
  user_id         uuid references users(id)        -- кто инициировал
  project_id      uuid references projects(id)
  kind            text not null                    -- 'llm.input' | 'llm.output' | 'image.generate' | ...
  amount          numeric(20, 6) not null          -- сколько единиц потреблено (токены, секунды, шт)
  unit            text not null                    -- 'tokens' | 'seconds' | 'images' | 'chars'
  cost_cents      integer                          -- расчётная стоимость в центах
  model           text                             -- 'claude-opus-4-7' и т.д.
  metadata        jsonb
  created_at      timestamptz default now()
  -- партиционировать по created_at когда вырастет

usage_counters
  organization_id uuid not null references organizations(id) on delete cascade
  period_start    date not null                    -- начало месяца обычно
  kind            text not null
  used            numeric(20, 6) not null default 0
  primary key (organization_id, period_start, kind)
```

### 3.6. API-токены проекта

```
project_tokens
  id            uuid PK
  project_id    uuid not null references projects(id) on delete cascade
  kind          text not null                       -- 'public' | 'server' | 'export'
  name          text not null                       -- человекочитаемое имя
  token_hash    text unique not null                -- bcrypt/argon2 хеш самого токена
  token_prefix  text not null                       -- первые 8 символов для UI ("pk_abc123…")
  created_by    uuid references users(id)
  created_at    timestamptz default now()
  last_used_at  timestamptz
  expires_at    timestamptz                          -- nullable = бессрочно
  revoked_at    timestamptz
```

### 3.7. Публикация

Поля публикации добавляются прямо в таблицу `projects` — раз публикация одна и предыдущие перетираются, отдельная таблица избыточна:

```
projects (продолжение)
  published_visibility    text                      -- null если не публиковался,
                                                    -- 'private' | 'authenticated' | 'public'
  published_at            timestamptz
  published_snapshot_id   uuid references snapshots(id)
                                                    -- ссылка на конкретный снапшот, который опубликован
  published_by            uuid references users(id)
  custom_domain           text                      -- nullable, для платных подписок
  custom_domain_status    text                      -- 'pending' | 'verified' | 'live' | 'failed'
  custom_domain_verified_at timestamptz
```

### 3.8. Снапшоты (минимальная заглушка)

Полноценное версионирование — отдельная фича вне этой спеки. Но для `published_snapshot_id` нужна таблица. Вводим минимальный вариант, который потом расширим:

```
snapshots
  id              uuid PK
  project_id      uuid not null references projects(id) on delete cascade
  commit_hash     text not null                     -- хеш в Gitea
  last_message_id uuid                              -- nullable пока чат не реализован
  title           text                              -- ручное название от юзера, опционально
  is_milestone    boolean default false             -- помеченные юзером важные версии
  created_at      timestamptz default now()
```

В первой версии запись в `snapshots` создаётся **только при публикации** (для ссылки в `published_snapshot_id`). Логика автоснапшотов на каждое сообщение AI и откат — отдельная спека.

### 3.9. Приглашения (заглушка структуры)

```
invitations
  id              uuid PK
  organization_id uuid references organizations(id) on delete cascade
  project_id      uuid references projects(id) on delete cascade
                                                    -- одно из двух заполнено
  email           text not null
  role_id         uuid not null references roles(id)
  invited_by      uuid not null references users(id)
  token_hash      text unique not null
  expires_at      timestamptz not null
  accepted_at     timestamptz
  accepted_by     uuid references users(id)
  created_at      timestamptz default now()
  check ((organization_id is not null) <> (project_id is not null))
```

В первой версии таблица существует, но через UI приглашения не создаются. Реализация — следующая спека.

### 3.10. Аудит-лог

```
audit_log
  id            uuid PK                              -- UUID v7
  actor_user_id uuid references users(id)            -- nullable для системных событий
  action        text not null                        -- 'user.login' | 'project.publish' | ...
  target_type   text                                 -- 'user' | 'project' | 'organization' | ...
  target_id     uuid
  organization_id uuid references organizations(id) -- для фильтрации по org-у в админке
  metadata      jsonb
  ip_address    inet
  user_agent    text
  created_at    timestamptz default now()
  -- индексы по actor_user_id, target_type+target_id, organization_id, created_at
```

### 3.11. Индексы

Помимо первичных ключей и уникальных индексов, обязательны:

- `users(email)` — для поиска при логине (уже unique).
- `accounts(user_id)` — для перечисления способов входа юзера.
- `sessions(user_id, expires_at)` — для cleanup и для перечисления активных сессий.
- `organization_members(user_id)` — для "все организации юзера".
- `project_members(user_id)` — для "все проекты, где юзер явный участник".
- `projects(organization_id, status)` — для списка проектов организации.
- `usage_events(organization_id, kind, created_at)` — для подсчёта потребления.
- `audit_log(actor_user_id, created_at)` и `audit_log(target_type, target_id, created_at)`.

### 3.12. Сидинг при первой миграции

Базовые данные, которые должны быть в БД сразу после накатки миграций:

1. Все роли из таблицы в Разделе 2.4.
2. Полный набор пермишенов (детальный список — в Документе 2).
3. Связи `role_permissions` для базовых ролей.
4. Маппинг `roles.default_project_role_id` для org-ролей.
5. План `free` с маленькими лимитами для trial.
6. Один admin-юзер с ролью `superadmin` (email и пароль — из переменных окружения при первом запуске).

---

## 4. Потоки авторизации

### 4.1. Регистрация по email

1. Юзер заполняет форму: email, пароль, имя.
2. Email нормализуется (gmail-точки, плюс-алиасы).
3. Проверка: нет ли активного юзера с таким нормализованным email. Если есть — возвращается общая ошибка "не удалось зарегистрироваться", без раскрытия что email занят (защита от перебора).
4. Создаётся запись в `users` (с `email_verified = false`), запись в `accounts` (provider = 'email'), персональная организация (тип `personal`, owner = юзер), членство в этой организации с ролью org-owner, активная подписка на план `free`.
5. Генерируется токен подтверждения, сохраняется в `verification_tokens`, отправляется на email.
6. До подтверждения юзер может войти, но не может создавать проекты, делать платные действия, заходить в опубликованные приложения уровня `authenticated`.
7. По клику на ссылку в письме — `email_verified = true`, токен помечается использованным.
8. Действие пишется в `audit_log` (`user.register`, `user.email_verify`).

### 4.2. Вход по email и паролю

1. Юзер вводит email и пароль.
2. Email нормализуется, ищется в `users`.
3. Проверяется хеш пароля.
4. Создаётся запись в `sessions`, токен сессии возвращается в HttpOnly cookie.
5. Если юзер `suspended` или `deleted` — отказ.
6. Действие пишется в `audit_log` (`user.login`).

### 4.3. Вход через OAuth (Google, Яндекс, VK)

1. Юзер кликает "Войти через Google".
2. Стандартный OAuth-флоу, callback возвращает данные провайдера: `provider_account_id` (sub), email, имя, аватар.
3. Поиск в `accounts` по `(provider, provider_account_id)`. Если нашли — это существующий юзер, открываем сессию.
4. Если не нашли — проверяется email из ответа OAuth-провайдера (нормализованный).
   - Если есть юзер с таким email — **отказ** с сообщением "аккаунт с таким email уже существует, войдите старым способом и привяжите Google в настройках". Это и есть "строгий режим слияния".
   - Если нет — создаётся новый юзер (с `email_verified = true`, потому что провайдер уже верифицировал email), запись в `accounts`, персональная организация, free-подписка.
5. Открывается сессия. Действие пишется в `audit_log`.

### 4.4. Привязка дополнительного провайдера

1. Залогиненный юзер в настройках кликает "Привязать Google".
2. OAuth-флоу.
3. Если в `accounts` уже есть запись с этим `(provider, provider_account_id)` для **другого** юзера — отказ. Один OAuth-аккаунт может быть привязан только к одному юзеру платформы.
4. Если этот OAuth-аккаунт уже привязан к **текущему** юзеру — сообщение "уже привязан".
5. Иначе — создаётся запись в `accounts`. Email из OAuth не меняет email юзера.
6. Действие пишется в `audit_log` (`user.account_link`).

### 4.5. Восстановление пароля

1. Юзер вводит email на странице "Забыли пароль".
2. Если такого email нет в системе — UI всё равно показывает "ссылка отправлена" (не раскрываем существование).
3. Если есть — генерируется токен, кладётся в `verification_tokens` (тип `password_reset`), отправляется на email.
4. По клику на ссылку — форма нового пароля, проверяется токен.
5. Пароль обновляется, все активные сессии юзера инвалидируются (на всякий случай).
6. Действие пишется в `audit_log`.

### 4.6. Отзыв подтверждения email при смене

Не реализуется в первой версии. Email юзера зафиксирован при регистрации, изменить его через UI нельзя. Если очень надо — через админку.

---

## 5. Модель доступа

### 5.1. Принцип

Каждый запрос на чтение или изменение защищённого ресурса проходит проверку доступа. Проверка отвечает на вопрос: "имеет ли юзер X пермишен P в контексте C?".

Контекст — это либо проект, либо организация, либо глобальный (для админских действий).

### 5.2. Вычисление эффективной роли на проекте

Когда юзер пытается выполнить действие над проектом:

1. Найти проект и его организацию.
2. Найти `organization_members` для (юзер, организация). Если нет — у юзера нет доступа к этой организации, отказ.
3. По `organization_members.role_id` найти `roles.default_project_role_id` — это дефолтная project-роль.
4. Найти `project_members` для (юзер, проект). Если есть — взять её `role_id`.
5. Эффективная роль = роль с большим набором прав из (дефолтная, явная). Сравнение по подмножеству пермишенов.

### 5.3. Проверка пермишена

Для эффективной роли загружаются её пермишены через `role_permissions`. Если запрашиваемый пермишен входит в список — доступ есть.

### 5.4. Проверка квот

Для платных действий проверка идёт **дополнительно** к проверке пермишена.

1. Найти организацию проекта.
2. Найти активную подписку, её план, лимиты плана.
3. Применить override-ы из `plan_overrides` (мерджем JSON — override-ключи перекрывают plan-ключи).
4. Найти текущий `usage_counters` для (организация, текущий период, kind).
5. Если `used + estimated < limit` — пускаем. Иначе отказ.

### 5.5. Что возвращать при отказе

- **401 Unauthorized** — юзер не залогинен (нет валидной сессии).
- **403 Forbidden** — юзер залогинен, но нет права на действие (нет членства, нет роли, нет пермишена).
- **402 Payment Required** — пермишен есть, но превышена квота плана.
- **404 Not Found** — для случаев, когда мы не хотим раскрывать существование ресурса.
- **423 Locked** — для `email_verified = false` при попытке делать действия, требующие подтверждённой почты.

В теле ответа всегда есть машиночитаемый `error.code` и человекочитаемый `error.message`. Для квот — дополнительно `error.quota` с информацией о лимите и периоде.

### 5.6. Админский слой

Админские действия идут через отдельную проверку, которая смотрит в `admin_role_assignments`, а не в `organization_members`. Админский пермишен (например, `admin.users.ban`) даёт право независимо от членства в организации. Один человек может быть и обычным юзером с организациями, и админом одновременно — это два независимых слоя.

`is_admin` на `users` — это быстрый bool-флаг, копия "есть ли хоть одна непросроченная запись в `admin_role_assignments`". Поддерживается триггером или явной логикой при выдаче/отзыве админских ролей. Нужен для быстрых проверок без джойна.

---

## 6. Биллинг-заглушка

### 6.1. Состояние подписки

При создании организации — автоматически активная подписка на план `free` со следующими параметрами:

- `current_period_start` = сейчас.
- `current_period_end` = сейчас + 1 месяц.
- `status = active`.
- `provider = manual`.

В первой версии подписка автоматически продлевается каждый месяц джобой (просто сдвигается `current_period_*`, `usage_counters` обнуляются для нового периода). Реальная оплата не реализуется.

### 6.2. Структура лимитов

`plans.limits` — это JSON-объект с ключами вида `<resource>.<unit>.<period>`:

- `llm.tokens.monthly` — суммарные токены LLM за месяц.
- `image.generations.monthly` — генерации изображений.
- `stt.minutes.monthly` — минуты распознавания речи.
- `tts.chars.monthly` — символы синтеза речи.
- `projects.max` — максимум активных проектов в организации (не периодический, абсолютный).
- `members_per_project.max` — максимум участников на один проект.

Ключи произвольные, добавляются по мере появления новых платных функций. Проверка квот работает с любым ключом — главное, чтобы тот же ключ использовался при записи `usage_events.kind` и в `usage_counters.kind`.

### 6.3. План free для trial

Стартовые значения (можно править через админку):

```json
{
  "llm.tokens.monthly": 100000,
  "image.generations.monthly": 10,
  "stt.minutes.monthly": 5,
  "tts.chars.monthly": 5000,
  "projects.max": 1,
  "members_per_project.max": 1
}
```

Конкретные числа — на твоё усмотрение, они в любом случае правятся через админку без релиза.

### 6.4. Override-ы

Когда саппорт хочет дать конкретной организации больше квот — создаёт запись в `plan_overrides` с частичным JSON. Например, `{"llm.tokens.monthly": 1000000}` — увеличить только токены, остальные лимиты остаются от плана. Override может быть бессрочным (`expires_at = null`) или временным.

### 6.5. Учёт потребления

После каждой платной операции:

1. Пишется событие в `usage_events` со всеми деталями.
2. Инкрементируется счётчик в `usage_counters` для (организация, текущий период, kind).

Перед каждой платной операцией — проверка по `usage_counters` (см. Раздел 5.4). На границе периода счётчики обнуляются (создаются записи с `used = 0` для нового `period_start`).

### 6.6. Что не реализуется сейчас

- Подключение реальных платёжек (Stripe, ЮKassa).
- Smene плана (upgrade/downgrade) с пересчётом лимитов.
- Грейс-период при `past_due`.
- Уведомления о приближении к лимиту.

Все эти вещи добавляются позже, без изменения схемы БД — только новый код.

---

## 7. Публикация

### 7.1. Первая публикация

1. Юзер с пермишеном `project.publish` нажимает кнопку Publish.
2. Если `preview_subdomain` ещё не зафиксирован — генерируется (из текущего slug проекта плюс короткого случайного суффикса для уникальности), пишется в проект, `preview_subdomain_locked = true`.
3. Создаётся запись в `snapshots` для текущего состояния (`commit_hash` из Gitea, `last_message_id` пока null).
4. В `projects` записываются: `published_snapshot_id` = id нового снапшота, `published_at` = now, `published_visibility` = выбранная юзером (`private` по умолчанию), `published_by` = юзер.
5. Билд-воркер собирает статику для этого коммита, кладёт в директорию для отдачи Caddy, Caddy матчит поддомен.
6. Действие пишется в `audit_log`.

### 7.2. Повторная публикация

То же самое, но:

- `preview_subdomain` уже зафиксирован — не меняется, даже если юзер переименовал проект.
- Старая директория со статикой перезаписывается. Старые снапшоты в `snapshots` остаются (для истории), но фактически статика только последняя.

### 7.3. Изменение visibility без новой публикации

Юзер может в любой момент сменить `published_visibility` без запуска нового билда. Это просто update поля — Caddy и логика отдачи статики проверяют текущее значение при каждом запросе.

### 7.4. Логика доступа к опубликованному приложению

При запросе на `https://<subdomain>.<твой-домен>.com`:

- `published_visibility = public` — отдаём всем без проверок.
- `published_visibility = authenticated` — проверяем сессию платформы. Если юзер залогинен и `email_verified = true` — отдаём. Иначе — редирект на страницу логина.
- `published_visibility = private` — проверяем сессию, **подтверждённый email**, и членство в проекте (любая роль). Если нет — 403.

### 7.5. Кастомные домены

Структура заложена (`projects.custom_domain`, `custom_domain_status`), но логика верификации и привязки в первой спеке не реализуется. Доступна только на платных тарифах (флаг `features.custom_domains` в плане).

---

## 8. API-токены проекта

### 8.1. Создание

Юзер с пермишеном `project.tokens.manage` (входит в роли publisher и owner) на странице настроек проекта нажимает "Создать токен", выбирает kind (`public` / `server` / `export`), задаёт имя.

Токен генерируется как случайная строка (например, `pk_live_<32 символа>` для public, `sk_live_<32 символа>` для server). Хеш записывается в `project_tokens.token_hash`, сам токен показывается юзеру **один раз** во всплывающем окне.

В таблицу пишется `token_prefix` — первые 8 символов после префикса, для отображения в списке токенов вида `pk_live_abc12345...`.

### 8.2. Использование

Когда приходит запрос с заголовком `Authorization: Bearer <token>`:

1. Извлекается префикс из токена.
2. По префиксу делается быстрый поиск кандидатов в `project_tokens`.
3. Хеш токена сравнивается с `token_hash` каждого кандидата (обычно один).
4. Если найден — обновляется `last_used_at`, проверяется `revoked_at` и `expires_at`.
5. Дальше работа идёт от имени **проекта**, не от имени юзера. Соответствующие пермишены назначаются по `kind` токена.

### 8.3. Отзыв

Юзер с пермишеном на токены может пометить токен как отозванный — `revoked_at = now`. Запись не удаляется (для аудита), но больше не валидна.

### 8.4. Поле data_backend на проекте

Это JSON, хранящий конфигурацию подключения к хранилищу данных приложения. Возможные формы:

```json
{ "type": "appwrite", "project_id": "abc123", "endpoint": "https://appwrite.example.com/v1" }
```

или

```json
{ "type": "internal", "namespace": "app_<project_id>" }
```

Логика работы с этим бэкендом — отдельная спека. Сейчас просто заводим поле, чтобы при создании проекта можно было его инициализировать.

---

## 9. Админский слой

### 9.1. Минимум для первой версии

В первой спеке UI админки не делается. Делаются только защищённые API-эндпоинты, которые обращается к ним внутренний инструмент или сам разработчик через curl/Postman:

- Список юзеров с фильтрами и пагинацией.
- Бан/разбан юзера (`status = suspended`).
- Просмотр организаций юзера, их подписок.
- Создание override-а лимитов для организации.
- Изменение плана организации.
- Изменение полей плана (limits, features).
- Выдача и отзыв админских ролей юзерам.
- Просмотр аудит-лога с фильтрами.

### 9.2. Защита админских эндпоинтов

Все админские эндпоинты требуют:

1. Валидную сессию.
2. `users.is_admin = true`.
3. Конкретный admin-пермишен для конкретного действия (например, `admin.plans.update` для изменения плана).

### 9.3. Гибкость ролей бэк-офиса

Изначально в системе три admin-роли: superadmin, support, finance. Все они в `roles` со scope `admin`. Какие конкретно admin-пермишены входят в каждую — задаётся через `role_permissions` и правится в БД (или потом через UI админки).

Можно создавать новые admin-роли — например, `content_moderator` с минимальным набором пермишенов. Для этого добавляется запись в `roles` и связи в `role_permissions`. Никакого изменения кода не требуется.

---

## 10. Аудит-лог

### 10.1. Что обязательно логируется

- `user.register`, `user.email_verify`, `user.login`, `user.logout`, `user.password_reset`.
- `user.account_link`, `user.account_unlink`.
- `user.suspend`, `user.unsuspend`, `user.delete`.
- `organization.create`, `organization.update`, `organization.delete`.
- `organization.member_add`, `organization.member_remove`, `organization.member_role_change`.
- `project.create`, `project.update`, `project.archive`, `project.delete`.
- `project.member_add`, `project.member_remove`, `project.member_role_change`.
- `project.publish`, `project.unpublish`, `project.visibility_change`.
- `project.token_create`, `project.token_revoke`.
- `subscription.change`, `plan_override.create`, `plan_override.expire`.
- `admin_role.grant`, `admin_role.revoke`.
- `plan.update` (правка самого плана через админку).

### 10.2. Что НЕ логируется в аудит

- Каждый отдельный LLM-вызов и расход квоты — это уровень `usage_events`, не аудита.
- Каждый просмотр страницы или API-запрос на чтение — слишком шумно.

### 10.3. Просмотр

В первой версии — только через админский API-эндпоинт с фильтрами по actor, target, периоду, типу действия. UI — позже.

---

## 11. Миграция от текущего форка

### 11.1. Подход

Текущий форк — однопользовательский, реальных юзеров нет, тестовые данные не важны. Поэтому миграция — **полное обнуление БД** и накатывание новой схемы с нуля. Никакого переноса существующих проектов.

### 11.2. Шаги

1. Дроп существующей БД (или новый деплой с пустой БД).
2. Накатка миграций Drizzle для всех новых таблиц.
3. Сидинг базовых данных (Раздел 3.12).
4. Создание начального admin-юзера: email/пароль из переменных окружения, `is_admin = true`, выдача роли `superadmin` через `admin_role_assignments`. Этот юзер также получает свою персональную организацию по общим правилам.
5. После этого приложение готово к регистрации обычных юзеров.

### 11.3. Что меняется в коде вне auth-слоя

В коде форка все обращения к проектам сейчас идут без проверки владельца. После внедрения авторизации все эти места должны:

- Работать в контексте сессии (есть `current_user_id`).
- Проверять доступ к запрашиваемому проекту по правилам Раздела 5.
- Списывать платное потребление в `usage_events` от имени `current_user_id` и организации проекта.

Конкретный список мест и патчи — в Документе 2.

---

## 12. Открытые вопросы и заглушки

Эти вещи отражены в схеме, но в первой версии не реализуются:

| Что | Где в схеме | Когда реализуется |
|-----|-------------|-------------------|
| Приглашения участников | таблица `invitations` | Следующая спека |
| Реферальная программа | поля `referrer_id`, `referral_code` в `users` | Далеко потом, отдельная спека с админским управлением программами |
| Кастомные домены | поля `custom_domain*` в `projects` | После базовой публикации |
| Telegram, Max OAuth | значения `provider` в `accounts` | По мере необходимости |
| Выход из организации | — | Большая отдельная фича |
| Полноценная админка | — | По мере необходимости, эндпоинты есть с самого начала |
| Сменa email юзером | — | Когда понадобится |
| Истечение и продление сессий | — | Простое продление есть, refresh-токены не делаем сейчас |

---

## 13. Что вне этой спеки полностью

Эти темы обсуждались по ходу проектирования, важны для общей картины продукта, но не относятся к авторизации и не реализуются в этой спецификации. Зафиксированы здесь, чтобы не потерялись при планировании следующих спек.

### 13.1. Версионирование и снапшоты (полная версия)

Снапшот — связка коммита Gitea и id последнего сообщения чата. Автоматический снапшот на каждое значимое изменение от AI. Юзер может пометить снапшот как milestone с названием. Откат — revert commit для кода плюс физическое удаление сообщений чата после точки отката. История git сохраняется (через revert), история чата — нет.

В этой спеке таблица `snapshots` существует в минимальном виде только для ссылки из публикации.

### 13.2. Чат и контекст

В первой версии — один активный чат на проект плюс редактируемая markdown-память проекта (`projects.memory`), подаваемая в системный промпт.

В будущем — явные чат-сессии (структура `chat_sessions` уже заложена), потом умный поиск по архиву через embeddings, потом эволюция памяти в шаренные между проектами скилы с автообучением. Это потенциальное отличие от Lovable и Base44.

### 13.3. Билд и превью

Каждое изменение от AI триггерит rebuild Vite. Билд идёт в отдельном Docker-контейнере-воркере. Очередь билдов — пока нет, для multi-tenant нужно добавить. Источник правды для файлов — Gitea с сервисным юзером-владельцем всех репо.

### 13.4. Стартовый шаблон

Один boilerplate Vite + React + Tailwind + shadcn/ui, копируется при создании проекта.

### 13.5. Превью и кастомные домены

Wildcard на Cloudflare DNS, Caddy с плагином cloudflare для wildcard-сертификатов. Кастомные домены через CNAME юзера, доступны на платных тарифах.

### 13.6. Стриминг ответов AI

Уже работает через Vercel AI SDK с Anthropic. Сохранение стрима в Redis для переподключения после потери соединения — отдельная задача.

### 13.7. Медиа

Картинки и аудио хранятся прямо в git-репозитории проекта с жёсткими лимитами на размер файла и общий размер. Внешнего объектного хранилища пока нет.

### 13.8. Голос

STT для голосовых промптов в чате, TTS для озвучки ответов AI — платные функции, лимиты считаются через `usage_events`.

### 13.9. Хранилище данных приложений

Аналог Supabase/Appwrite для опубликованных приложений. Каждое приложение имеет своё изолированное хранилище, юзер платформы может через UI редактировать схему, данные, функции, смотреть логи. Юзеры опубликованного приложения — отдельная сущность, никак не пересекающаяся с юзерами платформы.

В этой спеке заложены: пермишены про данные/схему/функции/логи, поле `data_backend` на проекте, типизация токенов проекта (public/server/export). Сама реализация data backend — отдельный большой проект.

### 13.10. Модерация и rate limiting

Не реализуется сейчас. Часть закрывается биллингом и квотами. Полноценная модерация контента, бан по IP, ratelimit на уровне эндпоинтов — позже.

### 13.11. Скейлинг инфры

Сейчас всё на одном сервере. По мере роста — выделение билд-воркеров на отдельные машины, отдельный сервер БД, отдельный Redis, отдельный Caddy/прокси.

---

## Резюме

Эта спека описывает **что** должно появиться в системе. Она не описывает **как** это реализовать в коде.

После одобрения этого документа — переход к Документу 2, где будут:

- Подробные API-эндпоинты с параметрами и форматом ответов.
- Псевдокод ключевых helper-ов (проверка прав, проверка квот).
- Описание middleware и точек интеграции с существующим кодом форка.
- Конкретные места в текущем коде, которые нужно изменить.
- Тесты, которые должны быть написаны.

Документ 2 пишется на основе этого, после того как Документ 1 утверждён.