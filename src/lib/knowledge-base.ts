// Internal LUNO DIGITAL knowledge base. Static, read-only content shipped with
// the app; it describes the project as it exists in this repository.

export const KB_CATEGORIES = ["Backend", "Auth", "Database", "Security", "DevOps"] as const;
export type KbCategory = (typeof KB_CATEGORIES)[number];

export type KbBlock =
  | { type: "p"; text: string }
  | { type: "list"; items: string[] }
  | { type: "code"; code: string }
  | { type: "note"; text: string }
  | { type: "warning"; text: string };

export type KbSection = { heading: string; blocks: KbBlock[] };

export type KbArticle = {
  id: string;
  title: string;
  category: KbCategory;
  summary: string;
  sections: KbSection[];
  steps?: string[];
  importantNotes: string[];
  relatedArticles: string[];
};

export const KB_ARTICLES: KbArticle[] = [
  {
    id: "backend-architecture",
    title: "Архитектура backend LUNO DIGITAL",
    category: "Backend",
    summary: "Из каких частей состоит серверная сторона: TanStack Start, Supabase в Lovable Cloud и Edge Functions.",
    sections: [
      {
        heading: "Три слоя",
        blocks: [
          { type: "list", items: [
            "TanStack Start — приложение и server functions в src/lib/*.functions.ts. Выполняются на сервере, вызываются из React как обычные функции.",
            "Supabase (проект в Lovable Cloud) — Postgres, Auth, RLS и RPC-функции. Это источник истины для данных и прав.",
            "Supabase Edge Functions в supabase/functions/ — операции, которым нужен Auth Admin API: создание сотрудника, выдача и смена временного пароля, сброс пароля владельца.",
          ] },
        ],
      },
      {
        heading: "Как проходит запрос",
        blocks: [
          { type: "p", text: "Клиент вызывает server function. Middleware requireSupabaseAuth проверяет JWT из заголовка Authorization и создаёт Supabase-клиент от имени пользователя. Дальше все запросы к таблицам и RPC идут с правами этого пользователя, и их ограничивает RLS." },
          { type: "code", code: "export const getWorkspace = createServerFn({ method: \"GET\" })\n  .middleware([requireSupabaseAuth])\n  .handler(async ({ context }) => {\n    // context.supabase — клиент от имени пользователя\n    // context.userId  — id из проверенного JWT\n  });" },
        ],
      },
      {
        heading: "Где лежит логика",
        blocks: [
          { type: "list", items: [
            "Правила доступа — в БД: RLS-политики и функции is_active_user, has_permission, can_access_project.",
            "Изменение статуса задачи и таймер — только RPC task_transition.",
            "Server functions — тонкий слой: валидация входа через zod, вызов RPC или таблицы, возврат результата.",
          ] },
        ],
      },
    ],
    importantNotes: [
      "Права нельзя проверять только в интерфейсе: интерфейс скрывает кнопки, а реальную проверку делает БД.",
      "Service role не используется в обычных запросах — см. статью о правилах service role.",
    ],
    relatedArticles: ["server-functions", "supabase-rpc", "edge-functions", "rls"],
  },
  {
    id: "server-functions",
    title: "Server Functions в TanStack Start",
    category: "Backend",
    summary: "Как написать серверную функцию: middleware авторизации, валидация входа и вызов Supabase от имени пользователя.",
    sections: [
      {
        heading: "Шаблон",
        blocks: [
          { type: "code", code: "export const updateTask = createServerFn({ method: \"POST\" })\n  .middleware([requireSupabaseAuth])\n  .inputValidator((d: Input) => schema.parse(d))\n  .handler(async ({ data, context }) => {\n    const { error } = await context.supabase.from(\"tasks\").update(...);\n    if (error) throw new Error(error.message);\n    return { ok: true };\n  });" },
          { type: "p", text: "На клиенте функция вызывается через useServerFn: const update = useServerFn(updateTask); await update({ data })." },
        ],
      },
      {
        heading: "Правила",
        blocks: [
          { type: "list", items: [
            "Файлы называются *.functions.ts и лежат в src/lib/.",
            "Каждая функция, работающая с данными пользователя, подключает requireSupabaseAuth.",
            "Вход валидируется через zod в inputValidator — не доверяйте данным с клиента.",
            "Ошибки Supabase превращаются в Error с понятным сообщением; секреты и пароли в сообщения не попадают.",
          ] },
          { type: "warning", text: "Модуль client.server.ts (service role) импортируется только динамически внутри handler: await import(\"@/integrations/supabase/client.server\"). Файлы *.functions.ts попадают и в клиентскую сборку." },
        ],
      },
    ],
    importantNotes: [
      "context.userId берётся из проверенного JWT — используйте его, а не id, присланный клиентом.",
      "Функции, которым нужен Auth Admin API, вынесены в Edge Functions.",
    ],
    relatedArticles: ["backend-architecture", "service-role", "env-secrets"],
  },
  {
    id: "supabase-rpc",
    title: "Supabase RPC в LUNO DIGITAL",
    category: "Database",
    summary: "Какие RPC-функции есть в проекте, как их вызывать и почему важные операции идут через них.",
    sections: [
      {
        heading: "Зачем RPC",
        blocks: [
          { type: "p", text: "RPC — это функции Postgres. Они выполняют операцию атомарно и проверяют права внутри БД, поэтому их нельзя обойти прямым запросом к таблице." },
          { type: "code", code: "const { data, error } = await context.supabase.rpc(\"task_transition\", {\n  _task_id: taskId, _action: \"start\", _session_id: sessionId,\n});" },
        ],
      },
      {
        heading: "Основные функции",
        blocks: [
          { type: "list", items: [
            "task_transition — статусы задачи и таймер: start, pause, resume, wait, complete, reopen.",
            "has_permission(_permission) — есть ли у текущего пользователя право.",
            "get_my_nexa_access_flags — собственные уровень, роль, VIP и активность.",
            "get_admin_panel_data — данные Admin Panel; требует admin.access, employees.read и profiles.private.read.",
            "update_admin_employee — изменение сотрудника с проверкой каждого поля.",
            "create / get_my / review / cancel_access_level_request — заявки на повышение доступа.",
            "get_my_credential_state — нужна ли обязательная смена пароля.",
          ] },
        ],
      },
    ],
    steps: [
      "Опишите функцию в миграции в supabase/migrations/.",
      "Отзовите EXECUTE у public и anon, выдайте authenticated (или только service_role).",
      "Примените миграцию в SQL-редакторе Cloud.",
      "Добавьте типы функции в src/integrations/supabase/types.ts.",
    ],
    importantNotes: [
      "Сигнатура в Cloud — источник истины. Перед изменением клиента сверяйтесь с фактическим определением функции.",
      "RPC заявок на доступ принимают решение approve или reject, а в строке заявки статус хранится как approved или rejected.",
    ],
    relatedArticles: ["security-definer", "access-requests", "profile-structure"],
  },
  {
    id: "supabase-auth",
    title: "Авторизация через Supabase Auth",
    category: "Auth",
    summary: "Как сотрудник входит в систему и что происходит после входа.",
    sections: [
      {
        heading: "Вход",
        blocks: [
          { type: "p", text: "Страница /auth использует signInWithPassword: email и пароль. Самостоятельной регистрации нет — учётные записи создаёт Admin Panel." },
          { type: "note", text: "Если вы забыли пароль, обратитесь к владельцу: восстановление через почту не предусмотрено." },
        ],
      },
      {
        heading: "Проверка после входа",
        blocks: [
          { type: "list", items: [
            "get_my_credential_state — если требуется смена пароля, переход на /change-password.",
            "getCurrentProfile — профиль и is_active_user(); отключённая учётка получает экран «Доступ закрыт».",
            "has_permission('admin.access') — показывать ли кнопку «Админ».",
          ] },
        ],
      },
      {
        heading: "Сессия на сервере",
        blocks: [
          { type: "p", text: "Клиент отправляет access token в заголовке Authorization. Middleware requireSupabaseAuth проверяет его и передаёт в server function userId и claims." },
        ],
      },
    ],
    importantNotes: [
      "Профиль создаётся только при создании сотрудника. ensure_my_profile больше не создаёт профили для произвольных пользователей Auth.",
    ],
    relatedArticles: ["temporary-passwords", "mandatory-password-change", "roles-levels"],
  },
  {
    id: "temporary-passwords",
    title: "Временные пароли сотрудников",
    category: "Auth",
    summary: "Как создаётся сотрудник с системным логином и временным паролем и как пароль выдаётся повторно.",
    sections: [
      {
        heading: "Создание сотрудника",
        blocks: [
          { type: "p", text: "В Admin Panel вводятся ФИО, должность, отдел, роль, уровень и VIP. Логин и пароль генерирует Edge Function admin-create-employee." },
          { type: "list", items: [
            "Логин — свободный корпоративный адрес по ФИО, например blokhina.valeriya.romanovna@nexa.ru.",
            "Пароль — 20 символов из криптографически стойкого генератора.",
            "Срок действия — 72 часа.",
            "Затем создаются записи employee_credentials, profiles и user_roles. Если шаг не удался, всё откатывается.",
          ] },
          { type: "warning", text: "Пароль показывается один раз в окне Admin Panel. Он не хранится в БД и не попадает в логи — скопируйте его сразу." },
        ],
      },
      {
        heading: "Повторная выдача",
        blocks: [
          { type: "p", text: "Кнопка «Сгенерировать новый временный пароль» доступна только владельцу. Edge Function admin-reissue-temporary-password заменяет пароль, снова ставит срок 72 часа и отзывает сессии сотрудника." },
        ],
      },
    ],
    importantNotes: [
      "Не-владелец может создать только сотрудника с ролью employee и уровнем 2.",
      "Создание с VIP требует права vip.manage.",
    ],
    relatedArticles: ["mandatory-password-change", "edge-functions", "session-revocation"],
  },
  {
    id: "mandatory-password-change",
    title: "Mandatory Password Change",
    category: "Auth",
    summary: "Почему новый сотрудник обязан сменить временный пароль и как это защищено.",
    sections: [
      {
        heading: "Как работает",
        blocks: [
          { type: "p", text: "Пока в employee_credentials для пользователя must_change_password = true, функция is_active_user() возвращает false. На ней построены RLS и проверка прав, поэтому данные закрыты даже при прямом запросе к API." },
          { type: "code", code: "employee_credentials\n  user_id, must_change_password, issued_at,\n  expires_at, changed_at, issued_by" },
        ],
      },
      {
        heading: "Требования к новому паролю",
        blocks: [
          { type: "list", items: [
            "Не короче 12 символов.",
            "Строчная и заглавная латинские буквы, цифра и спецсимвол.",
            "Не совпадает с временным паролем.",
          ] },
        ],
      },
    ],
    steps: [
      "Войдите с логином и временным паролем.",
      "Система откроет /change-password.",
      "Введите и подтвердите новый пароль.",
      "complete-password-change снимет флаг, после этого откроется рабочее пространство.",
    ],
    importantNotes: [
      "Если 72 часа истекли, появится «Временный пароль истёк». Новый пароль выдаёт только владелец.",
      "У пользователей без записи в employee_credentials (все прежние учётные записи) смена пароля не требуется.",
    ],
    relatedArticles: ["temporary-passwords", "rls", "supabase-auth"],
  },
  {
    id: "profile-structure",
    title: "Структура профиля сотрудника",
    category: "Database",
    summary: "Поля таблицы profiles и кто какие из них может читать и менять.",
    sections: [
      {
        heading: "Поля",
        blocks: [
          { type: "code", code: "profiles\n  id, full_name, email, position, department,\n  phone, location, avatar_url, presence,\n  access_level (1–5), is_vip, is_active,\n  mailbox_status, invitation_status,\n  created_at, updated_at" },
        ],
      },
      {
        heading: "Чтение",
        blocks: [
          { type: "p", text: "Роль authenticated может напрямую читать только публичные колонки: id, full_name, position, department, avatar_url, presence, created_at, updated_at и is_vip." },
          { type: "p", text: "Строки ограничивает политика can_view_profile: свой профиль, коллеги по проектам или все — при праве profiles.read_all. Email, телефон, локация и уровень доступны через get_admin_panel_data при наличии прав." },
        ],
      },
      {
        heading: "Изменение",
        blocks: [
          { type: "list", items: [
            "Свой профиль: full_name, position, department, phone, location, avatar_url, presence — при праве profiles.write.",
            "access_level, is_vip, is_active и роль меняются только через update_admin_employee.",
          ] },
        ],
      },
    ],
    importantNotes: ["Попытка выбрать приватную колонку напрямую вернёт permission denied for table profiles."],
    relatedArticles: ["rls", "roles-levels", "supabase-rpc"],
  },
  {
    id: "rls",
    title: "Row Level Security (RLS)",
    category: "Security",
    summary: "Как RLS ограничивает доступ к строкам и почему это главный рубеж защиты.",
    sections: [
      {
        heading: "Принцип",
        blocks: [
          { type: "p", text: "RLS включён на таблицах с данными. Политика решает, какие строки видит и меняет пользователь, независимо от того, откуда пришёл запрос." },
          { type: "code", code: "create policy \"Read tasks of accessible projects\" on public.tasks\n  for select to authenticated\n  using (public.can_access_project(project_id, auth.uid()));" },
        ],
      },
      {
        heading: "Ключевые функции политик",
        blocks: [
          { type: "list", items: [
            "is_active_user — профиль активен и нет обязательной смены пароля.",
            "can_access_project — право projects.read_all, владение или участие в проекте.",
            "can_view_profile — свой профиль, коллеги по проектам или profiles.read_all.",
          ] },
        ],
      },
    ],
    importantNotes: [
      "RLS не заменяет GRANT: без права на колонку запрос падает раньше, чем проверяется политика.",
      "Таблицы employee_credentials и nexa_owners закрыты для authenticated полностью.",
    ],
    relatedArticles: ["security-definer", "profile-structure", "roles-levels"],
  },
  {
    id: "security-definer",
    title: "SECURITY DEFINER RPC",
    category: "Security",
    summary: "Когда функции выполняются с правами владельца и как писать их безопасно.",
    sections: [
      {
        heading: "Что это",
        blocks: [
          { type: "p", text: "Функция SECURITY DEFINER выполняется с правами своего владельца (postgres), а не вызывающего. Так проверки в политиках могут читать закрытые таблицы, например nexa_owners или employee_credentials." },
        ],
      },
      {
        heading: "Обязательные правила",
        blocks: [
          { type: "list", items: [
            "Всегда задавайте set search_path = public, pg_temp.",
            "Внутри проверяйте auth.uid() и права — функция обходит RLS.",
            "Отзывайте EXECUTE у public и anon, выдавайте только нужной роли.",
            "Возвращайте только данные текущего пользователя или то, что разрешено его правам.",
          ] },
          { type: "code", code: "create or replace function public.get_my_credential_state()\nreturns jsonb language plpgsql stable security definer\nset search_path = public, pg_temp as $$ ... $$;\nrevoke execute on function public.get_my_credential_state() from public, anon;\ngrant execute on function public.get_my_credential_state() to authenticated;" },
        ],
      },
    ],
    importantNotes: ["revoke_user_sessions доступна только service_role и вызывается из Edge Function."],
    relatedArticles: ["rls", "supabase-rpc", "session-revocation"],
  },
  {
    id: "roles-levels",
    title: "Роли и уровни доступа",
    category: "Security",
    summary: "Как роли, уровни 1–5 и реестр владельцев вместе определяют права сотрудника.",
    sections: [
      {
        heading: "Три источника прав",
        blocks: [
          { type: "list", items: [
            "Роль в user_roles: employee, manager, director или admin. Права роли — в role_permissions.",
            "Уровень доступа profiles.access_level от 1 до 5. Права уровня — в access_level_permissions.",
            "Реестр nexa_owners — владельцы получают все права.",
          ] },
          { type: "p", text: "has_permission_for объединяет все три источника и требует, чтобы учётная запись была активна." },
        ],
      },
      {
        heading: "Кто что меняет",
        blocks: [
          { type: "list", items: [
            "Уровень доступа меняет только владелец — напрямую или одобрив заявку.",
            "Роли admin и director назначает только владелец.",
            "Профиль владельца всегда остаётся активным, с ролью admin, уровнем 5 и VIP.",
          ] },
        ],
      },
    ],
    importantNotes: ["Admin Panel скрывает недоступные поля, но окончательную проверку делает update_admin_employee."],
    relatedArticles: ["access-requests", "rls", "profile-structure"],
  },
  {
    id: "service-role",
    title: "Service Role: правила использования",
    category: "Security",
    summary: "Где допустим ключ service role и почему его нельзя использовать в обычных запросах.",
    sections: [
      {
        heading: "Чем опасен",
        blocks: [
          { type: "p", text: "Клиент с ключом service role обходит RLS и все права. Утечка ключа равна полному доступу к базе." },
        ],
      },
      {
        heading: "Где используется",
        blocks: [
          { type: "list", items: [
            "Edge Functions — ключ подставляет окружение Supabase, в репозитории его нет.",
            "Отдельные server functions в admin.functions.ts — только после проверки прав вызывающего.",
          ] },
          { type: "warning", text: "Никогда не используйте префикс VITE_ для секретов: такие переменные попадают в браузер." },
        ],
      },
      {
        heading: "Правило по умолчанию",
        blocks: [
          { type: "p", text: "Для чтения данных используйте клиент пользователя и RPC с проверкой прав. Например, статусы учётных записей в Admin Panel читаются через get_employee_credential_states, а не через service role." },
        ],
      },
    ],
    importantNotes: ["Если для задачи кажется нужен service role, сначала проверьте, нельзя ли решить её RPC с SECURITY DEFINER."],
    relatedArticles: ["env-secrets", "edge-functions", "security-definer"],
  },
  {
    id: "env-secrets",
    title: "Environment Variables и секреты",
    category: "DevOps",
    summary: "Какие переменные окружения нужны проекту и где хранить секреты.",
    sections: [
      {
        heading: "Переменные проекта",
        blocks: [
          { type: "list", items: [
            "SUPABASE_URL и SUPABASE_PUBLISHABLE_KEY — для server functions.",
            "VITE_SUPABASE_URL и VITE_SUPABASE_PUBLISHABLE_KEY — для браузерного клиента. Публичные значения.",
            "SUPABASE_SERVICE_ROLE_KEY — только серверное окружение.",
          ] },
        ],
      },
      {
        heading: "Где хранить",
        blocks: [
          { type: "list", items: [
            ".env и *.local игнорируются git; локальные секреты — в .env.local.",
            "Секреты Edge Functions (OWNER_PASSWORD_RESET_TOKEN, NEXA_ALLOWED_ORIGINS) задаются в секретах проекта Lovable Cloud.",
          ] },
          { type: "warning", text: "Не вставляйте значения ключей в код, логи, тикеты и сообщения." },
        ],
      },
    ],
    importantNotes: ["После изменения .env перезапустите dev-сервер — переменные читаются при старте."],
    relatedArticles: ["service-role", "edge-functions", "git-workflow"],
  },
  {
    id: "edge-functions",
    title: "Edge Functions",
    category: "Backend",
    summary: "Какие Edge Functions есть в проекте, как они защищены и как их вызывает интерфейс.",
    sections: [
      {
        heading: "Функции",
        blocks: [
          { type: "list", items: [
            "admin-create-employee — создание сотрудника с временным паролем.",
            "admin-reissue-temporary-password — новый временный пароль (только владелец).",
            "complete-password-change — смена временного пароля самим сотрудником.",
            "owner-password-reset — сброс пароля владельца по секрету OWNER_PASSWORD_RESET_TOKEN.",
          ] },
          { type: "p", text: "Общий код — в supabase/functions/_shared: CORS и ответы, проверка вызывающего, генерация пароля и логина." },
        ],
      },
      {
        heading: "Защита",
        blocks: [
          { type: "p", text: "Первые три функции настроены с verify_jwt = true, и каждая дополнительно проверяет пользователя через auth.getUser(). Права проверяются теми же has_permission, что и в приложении." },
          { type: "code", code: "const { data, error } = await supabase.functions.invoke(\"admin-create-employee\", {\n  body: { fullName, role, accessLevel, isVip },\n});" },
        ],
      },
    ],
    importantNotes: [
      "Edge Functions разворачиваются в Cloud при синхронизации ветки main с Lovable.",
      "Ответы с ошибками содержат только безопасный текст — без паролей и внутренних деталей.",
    ],
    relatedArticles: ["temporary-passwords", "service-role", "git-workflow"],
  },
  {
    id: "session-revocation",
    title: "Отзыв пользовательских сессий",
    category: "Security",
    summary: "Как при повторной выдаче пароля закрываются сессии сотрудника.",
    sections: [
      {
        heading: "Механизм",
        blocks: [
          { type: "p", text: "В Auth Admin API нет отзыва сессий по id пользователя. Поэтому используется RPC revoke_user_sessions: она удаляет записи пользователя из auth.sessions, а refresh-токены удаляются вместе с ними." },
          { type: "p", text: "Уже выданный access token действует до истечения срока, но данных не получает: учётная запись снова под обязательной сменой пароля, и is_active_user() возвращает false." },
        ],
      },
    ],
    steps: [
      "Владелец нажимает «Сгенерировать новый временный пароль».",
      "Ставится must_change_password = true и новый срок 72 часа.",
      "Пароль в Auth заменяется — старый перестаёт работать.",
      "Вызывается revoke_user_sessions.",
    ],
    importantNotes: ["Функция доступна только service_role и требует, чтобы соответствующая миграция была применена в Cloud."],
    relatedArticles: ["temporary-passwords", "security-definer", "edge-functions"],
  },
  {
    id: "access-requests",
    title: "Заявки на повышение доступа",
    category: "Security",
    summary: "Как сотрудник запрашивает более высокий уровень и как владелец его одобряет.",
    sections: [
      {
        heading: "Сотрудник",
        blocks: [
          { type: "p", text: "Через «+ Заявка» → «Предоставление доступа» выберите уровень выше текущего и укажите причину. Одновременно может быть только одна заявка на рассмотрении; её можно отменить в «Уведомлениях»." },
        ],
      },
      {
        heading: "Владелец",
        blocks: [
          { type: "p", text: "Заявки, адресованные владельцу, появляются в «Уведомлениях» с кнопками «Одобрить» и «Отклонить». Уровень меняется только после одобрения." },
        ],
      },
      {
        heading: "Технически",
        blocks: [
          { type: "list", items: [
            "create_access_level_request, get_my_access_level_requests, review_access_level_request и cancel_access_level_request возвращают строки access_requests.",
            "Статусы: pending, approved, rejected, cancelled.",
            "Решение передаётся как approve или reject.",
          ] },
        ],
      },
    ],
    importantNotes: ["Администратор уровня 5, не являющийся владельцем, рассматривать заявки не может."],
    relatedArticles: ["roles-levels", "supabase-rpc"],
  },
  {
    id: "git-workflow",
    title: "Git workflow проекта",
    category: "DevOps",
    summary: "Как вносить изменения в репозиторий, связанный с Lovable, и не потерять историю.",
    sections: [
      {
        heading: "Связь с Lovable",
        blocks: [
          { type: "p", text: "Ветка main подключена к Lovable. Каждый push в main синхронизируется с редактором и запускает развёртывание, включая Edge Functions." },
          { type: "warning", text: "Не переписывайте опубликованную историю: никаких force push, rebase и amend уже запушенных коммитов. Lovable потеряет историю проекта." },
        ],
      },
      {
        heading: "Перед push",
        blocks: [
          { type: "code", code: "git fetch origin\ngit merge --ff-only origin/main\nnpx tsc --noEmit\nnpm run build" },
          { type: "list", items: [
            "Lovable тоже коммитит в main — сначала подтяните его изменения.",
            "Добавляйте в коммит файлы поимённо, не git add -A.",
            "Не коммитьте .env, .claude/ и supabase/.temp/.",
          ] },
        ],
      },
      {
        heading: "Миграции",
        blocks: [
          { type: "p", text: "SQL-миграции применяются в SQL-редакторе Cloud вручную. Перед коммитом миграции сверьте её с фактической схемой Cloud." },
        ],
      },
    ],
    importantNotes: ["Ветка main должна всегда собираться: npm run build без ошибок."],
    relatedArticles: ["env-secrets", "edge-functions"],
  },
];

export function articleText(article: KbArticle) {
  const blockText = (block: KbBlock) => ("items" in block ? block.items.join(" ") : "text" in block ? block.text : block.code);
  return [
    article.title,
    article.summary,
    ...article.sections.flatMap((section) => [section.heading, ...section.blocks.map(blockText)]),
    ...(article.steps ?? []),
    ...article.importantNotes,
  ].join(" ");
}

/** Lower-cased full text of each article, used for client-side search. */
export const KB_SEARCH_INDEX = new Map(KB_ARTICLES.map((article) => [article.id, `${article.category} ${articleText(article)}`.toLocaleLowerCase("ru-RU")]));

/** Reading time at ~120 words per minute (technical text with code), at least one minute. */
export function readingTime(article: KbArticle) {
  const words = articleText(article).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 120));
}
