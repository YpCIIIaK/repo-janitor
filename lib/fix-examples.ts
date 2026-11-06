/**
 * "How to fix" for the most frequent rules: one sentence per locale and a
 * minimal before/after pair. Keyed by `issue.rule` (see core/src/rules.ts).
 * Snippets are illustrative, not patches — they show the shape of the fix.
 */
export interface FixExample {
  how: { en: string; ru: string }
  before?: string
  after?: string
}

export const FIX_EXAMPLES: Record<string, FixExample> = {
  todo: {
    how: {
      en: "Do it, delete it, or move it to an issue tracker and link it — a years-old TODO is a decision nobody made.",
      ru: "Сделайте, удалите или перенесите в трекер со ссылкой — TODO многолетней давности это решение, которое никто не принял.",
    },
    before: "// TODO: handle timeouts\nconst res = await fetch(url)",
    after: "// Timeouts: see #482\nconst res = await fetch(url, { signal: AbortSignal.timeout(10_000) })",
  },
  "bus-factor": {
    how: {
      en: "Have a second person review or touch this file, and add a short comment or doc explaining what it does and why.",
      ru: "Пусть второй человек проревьюит или поправит файл; добавьте короткое описание, что он делает и зачем.",
    },
  },
  duplicate: {
    how: { en: "Extract the repeated block into one function and call it from both places.", ru: "Вынесите повторяющийся блок в одну функцию и вызывайте её из обоих мест." },
    before: "const a = items.filter(i => i.active).map(i => i.id)\n// … elsewhere\nconst b = users.filter(u => u.active).map(u => u.id)",
    after: "const activeIds = <T extends { active: boolean; id: string }>(xs: T[]) =>\n  xs.filter(x => x.active).map(x => x.id)\nconst a = activeIds(items)\nconst b = activeIds(users)",
  },
  "workflow-action-tag-first-party": {
    how: {
      en: "Pin the action to a full commit SHA and keep the tag as a comment; Dependabot or Renovate will keep it updated.",
      ru: "Закрепите action на полном SHA коммита, тег оставьте комментарием; Dependabot или Renovate будут его обновлять.",
    },
    before: "- uses: actions/checkout@v4",
    after: "- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2",
  },
  "workflow-action-tag": {
    how: {
      en: "A third-party tag can be moved to malicious code at any time. Pin to a full commit SHA.",
      ru: "Тег стороннего action могут в любой момент перевесить на вредоносный код. Закрепите на полном SHA.",
    },
    before: "- uses: some-org/deploy-action@v2",
    after: "- uses: some-org/deploy-action@3f1c2a9e0b7d4c5a6e8f9b0c1d2e3f4a5b6c7d8e # v2.1.0",
  },
  "workflow-action-unpinned": {
    how: { en: "Reference a release by commit SHA instead of a branch.", ru: "Ссылайтесь на релиз по SHA коммита, а не на ветку." },
    before: "- uses: some-org/tool@main",
    after: "- uses: some-org/tool@3f1c2a9e0b7d4c5a6e8f9b0c1d2e3f4a5b6c7d8e # v1.4.0",
  },
  "workflow-no-permissions": {
    how: {
      en: "Declare the minimum token permissions at the top of the workflow and widen per job only where needed.",
      ru: "Объявите минимальные права токена в начале workflow и расширяйте только в нужных jobs.",
    },
    before: "on: [push]\njobs:\n  test:",
    after: "on: [push]\npermissions:\n  contents: read\njobs:\n  test:",
  },
  "workflow-script-injection": {
    how: {
      en: "Pass the untrusted expression through an environment variable instead of splicing it into the script.",
      ru: "Передайте недоверенное выражение через переменную окружения, а не вставляйте его в скрипт.",
    },
    before: '- run: echo "${{ github.event.issue.title }}"',
    after: '- run: echo "$TITLE"\n  env:\n    TITLE: ${{ github.event.issue.title }}',
  },
  "dead-export": {
    how: {
      en: "Delete the export (or the whole symbol) if nothing uses it; if it is public API, document it as such.",
      ru: "Удалите экспорт (или весь символ), если он не используется; если это публичный API — задокументируйте.",
    },
    before: "export function formatLegacyDate(d: Date) { … }",
    after: "// removed: no imports anywhere in the repo",
  },
  "commented-code": {
    how: { en: "Delete it — git history keeps the old version.", ru: "Удалите — старая версия останется в истории git." },
    before: "// const total = items.reduce((s, i) => s + i.price, 0)\nconst total = sum(items)",
    after: "const total = sum(items)",
  },
  "doc-link": {
    how: { en: "Point the link at the file's new path, or remove it.", ru: "Исправьте ссылку на новый путь файла или удалите её." },
    before: "See [setup](docs/setup.md).",
    after: "See [setup](docs/getting-started/setup.md).",
  },
  "skipped-test": {
    how: {
      en: "Fix and re-enable the test, or delete it; a .only silently skips the rest of the suite.",
      ru: "Почините и включите тест или удалите его; .only молча отключает остальные тесты.",
    },
    before: "it.skip('parses dates', () => { … })",
    after: "it('parses dates', () => { … })",
  },
  "env-missing": {
    how: { en: "Add the variable to .env.example with a placeholder and a comment.", ru: "Добавьте переменную в .env.example с заглушкой и комментарием." },
    before: "# .env.example\nDATABASE_URL=",
    after: "# .env.example\nDATABASE_URL=\n# Stripe secret key (sk_test_… locally)\nSTRIPE_SECRET_KEY=",
  },
  "eol-node": {
    how: { en: "Move to a supported LTS line in CI, engines and Dockerfiles.", ru: "Перейдите на поддерживаемую LTS-версию в CI, engines и Dockerfile." },
    before: "- uses: actions/setup-node@…\n  with:\n    node-version: 16",
    after: "- uses: actions/setup-node@…\n  with:\n    node-version: 22",
  },
  "eol-python": {
    how: { en: "Move to a supported Python version and update requires-python.", ru: "Перейдите на поддерживаемую версию Python и обновите requires-python." },
    before: 'python-version: "3.7"',
    after: 'python-version: "3.12"',
  },
  bloat: {
    how: {
      en: "Remove the file from the repo and keep it in Git LFS, a release asset or object storage; add it to .gitignore.",
      ru: "Уберите файл из репозитория: в Git LFS, ассеты релиза или объектное хранилище; добавьте в .gitignore.",
    },
    before: "git add assets/demo.mp4",
    after: "git lfs track \"*.mp4\"\ngit add .gitattributes assets/demo.mp4",
  },
  "secret-provider": {
    how: {
      en: "Revoke the key at the provider first, then read it from the environment or a secret manager. Removing it from the file alone is not enough.",
      ru: "Сначала отзовите ключ у провайдера, затем читайте его из окружения или менеджера секретов. Просто удалить из файла недостаточно.",
    },
    before: 'const stripe = new Stripe("sk_live_51H…")',
    after: "const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)",
  },
  "secret-generic": {
    how: { en: "Rotate the value and load it from the environment.", ru: "Смените значение и загружайте его из окружения." },
    before: 'API_TOKEN = "9f8e7d6c5b4a39281706f5e4d3c2b1a0"',
    after: 'API_TOKEN = os.environ["API_TOKEN"]',
  },
  "secret-history": {
    how: {
      en: "The secret is in past commits: revoke it. Rewriting history (git filter-repo) only helps after revocation.",
      ru: "Секрет в старых коммитах: отзовите его. Переписывание истории (git filter-repo) имеет смысл только после отзыва.",
    },
  },
  "insecure-sql-interpolated": {
    how: { en: "Use a parameterised query; never build SQL from strings.", ru: "Используйте параметризованный запрос; не собирайте SQL из строк." },
    before: "db.query(`SELECT * FROM users WHERE id = ${req.params.id}`)",
    after: "db.query(\"SELECT * FROM users WHERE id = $1\", [req.params.id])",
  },
  "insecure-exec-interpolated": {
    how: {
      en: "Call the program with an argument array and no shell, so input cannot become a command.",
      ru: "Вызывайте программу с массивом аргументов и без shell — тогда ввод не станет командой.",
    },
    before: "exec(`convert ${file} out.png`)",
    after: 'execFile("convert", [file, "out.png"])',
  },
  "insecure-localstorage-secret": {
    how: {
      en: "Keep session tokens in an HttpOnly, Secure cookie set by the server, out of reach of page scripts.",
      ru: "Храните токены сессии в HttpOnly Secure cookie от сервера — вне досягаемости скриптов страницы.",
    },
    before: 'localStorage.setItem("token", jwt)',
    after: 'res.cookie("session", jwt, { httpOnly: true, secure: true, sameSite: "lax" })',
  },
  "insecure-innerhtml-dynamic": {
    how: { en: "Use textContent, or sanitise HTML with DOMPurify.", ru: "Используйте textContent или очищайте HTML через DOMPurify." },
    before: "el.innerHTML = comment.body",
    after: "el.textContent = comment.body",
  },
  "insecure-py-shell-true": {
    how: { en: "Pass a list of arguments and drop shell=True.", ru: "Передавайте список аргументов и уберите shell=True." },
    before: 'subprocess.run(f"git clone {url}", shell=True)',
    after: 'subprocess.run(["git", "clone", url], check=True)',
  },
  "insecure-py-yaml-load": {
    how: { en: "Use yaml.safe_load.", ru: "Используйте yaml.safe_load." },
    before: "data = yaml.load(f)",
    after: "data = yaml.safe_load(f)",
  },
  "docker-latest": {
    how: { en: "Pin the base image to a version (or a digest) so builds are reproducible.", ru: "Закрепите базовый образ на версии (или digest), чтобы сборки были воспроизводимы." },
    before: "FROM node:latest",
    after: "FROM node:22.11-alpine",
  },
  "docker-root": {
    how: { en: "Switch to an unprivileged user before the final command.", ru: "Переключитесь на непривилегированного пользователя перед финальной командой." },
    before: 'COPY . /app\nCMD ["node", "server.js"]',
    after: 'COPY --chown=node:node . /app\nUSER node\nCMD ["node", "server.js"]',
  },
  "ci-silenced-failure": {
    how: { en: "Let the step fail. If it is truly optional, say so with continue-on-error and a comment.", ru: "Дайте шагу падать. Если он правда необязателен — continue-on-error с комментарием." },
    before: "- run: npm test || true",
    after: "- run: npm test",
  },
  "lockfile-missing": {
    how: { en: "Commit the lockfile your package manager generates, and install with it in CI.", ru: "Закоммитьте lockfile вашего пакетного менеджера и устанавливайте по нему в CI." },
    before: "- run: npm install",
    after: "- run: npm ci   # package-lock.json committed",
  },
  "hygiene-no-tests": {
    how: { en: "Start with one test of the most important function, and run it in CI.", ru: "Начните с одного теста самой важной функции и запускайте его в CI." },
    after: 'import { test, expect } from "vitest"\nimport { parse } from "../src/parse"\n\ntest("parses a basic input", () => {\n  expect(parse("a=1")).toEqual({ a: "1" })\n})',
  },
  "hygiene-no-ci": {
    how: { en: "Add a minimal workflow that installs and runs the tests on every pull request.", ru: "Добавьте минимальный workflow, который ставит зависимости и гоняет тесты на каждом PR." },
    after: "# .github/workflows/ci.yml\non: [push, pull_request]\npermissions:\n  contents: read\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@<sha>\n      - run: npm ci && npm test",
  },
  "iac-open-admin-port": {
    how: { en: "Restrict the source range to your VPN or bastion, never 0.0.0.0/0.", ru: "Ограничьте источник вашим VPN или bastion, а не 0.0.0.0/0." },
    before: 'from_port   = 22\ncidr_blocks = ["0.0.0.0/0"]',
    after: 'from_port   = 22\ncidr_blocks = [var.office_cidr]',
  },
  "config-conflict": {
    how: { en: "Keep one config file and delete the one the tool ignores.", ru: "Оставьте один файл конфигурации и удалите тот, который инструмент игнорирует." },
  },
}

export function fixExampleFor(rule: string | undefined | null): FixExample | null {
  return (rule && FIX_EXAMPLES[rule]) || null
}
