import { describe, expect, it } from "vitest"
import { Project } from "../../src/scanners/php-taint/analyze"
import { auditAccessControl } from "../../src/scanners/php-taint/authz"
import { auditLogic } from "../../src/scanners/php-taint/logic"
import { selectScanners, withAddons, ALL_SCANNER_IDS } from "../../src/select-scanners"

function scan(files: Record<string, string>) {
  const p = new Project()
  for (const [f, c] of Object.entries(files)) p.add(f, c)
  p.run()
  return { taint: p.findings.map((f) => `${f.kind}@${f.file}:${f.line}`), authz: auditAccessControl(p).map((a) => `${a.kind === "missing-authz" ? "" : `${a.kind}:`}${a.action}@${a.file}:${a.line}`), logic: auditLogic(p).map((l) => `${l.kind}@${l.file}:${l.line}`) }
}

describe("php-taint add-on", () => {
  it("is off by default and can be enabled", () => {
    expect(ALL_SCANNER_IDS).not.toContain("php-taint")
    expect(withAddons(["php-taint"]).scanners.map((s) => s.id)).toContain("php-taint")
    expect(withAddons(["nope"]).unknown).toEqual(["nope"])
    expect(selectScanners(["php-taint"]).scanners.map((s) => s.id)).toEqual(["php-taint"])
  })

  it("follows request data through branches to SQL (DVWA low)", () => {
    const { taint } = scan({ "a.php": `<?php
$id = $_GET['id'];
if ($id) {
  $q = "SELECT first_name FROM users WHERE user_id = '$id'";
  $r = mysqli_query($conn, $q);
}` })
    expect(taint).toContain("sql@a.php:5")
  })

  it("escaping counts only inside quotes (DVWA medium)", () => {
    const quoted = scan({ "a.php": `<?php $id = mysqli_real_escape_string($c, $_POST['id']); mysqli_query($c, "SELECT * FROM t WHERE id = '$id'");` })
    const bare = scan({ "a.php": `<?php $id = mysqli_real_escape_string($c, $_POST['id']); mysqli_query($c, "SELECT * FROM t WHERE id = $id");` })
    expect(quoted.taint).toEqual([])
    expect(bare.taint).toEqual(["sql@a.php:1"])
  })

  it("validation guards with an exit, element checks and pinned values", () => {
    const { taint } = scan({ "a.php": `<?php
$ip = $_REQUEST['ip'];
$o = explode('.', $ip);
if (is_numeric($o[0]) && is_numeric($o[1])) {
  shell_exec('ping ' . $o[0] . '.' . $o[1]);
}
$ext = strtolower($_GET['ext']);
if ($ext !== 'jpg' && $ext !== 'png') { die('no'); }
system('convert x.' . $ext);
$name = $_GET['n'];
if (!ctype_alnum($name)) exit;
system('touch ' . $name);` })
    expect(taint).toEqual([])
  })

  it("project functions: wrappers are sources, helpers are sinks", () => {
    const { taint } = scan({
      "lib.php": `<?php function param($k) { return $_GET[$k]; } function run_sql($sql) { global $c; return mysqli_query($c, $sql); }`,
      "page.php": `<?php $u = param('user'); run_sql("DELETE FROM t WHERE u = " . $u);`,
    })
    expect(taint).toContain("sql@page.php:1")
  })

  it("request data passed between files through include", () => {
    const { taint } = scan({
      "index.php": `<?php require_once "source/" . $level . ".php"; echo "<div>{$html}</div>";`,
      "source/low.php": `<?php $html = 'Hello ' . $_GET['name'];`,
      "source/impossible.php": `<?php $html = 'Hello ' . htmlspecialchars($_GET['name']);`,
    })
    expect(taint).toContain("xss@index.php:1")
  })

  it("password reset for a user the request picks (CVE-2023-32243 shape)", () => {
    const vuln = scan({ "a.php": `<?php
function reset_it() {
  $login = sanitize_text_field($_POST['rp_login']);
  $user = get_user_by('login', $login);
  reset_password($user, $_POST['pass']);
}` })
    const fixed = scan({ "a.php": `<?php
function reset_it() {
  $user = check_password_reset_key($_POST['rp_key'], $_POST['rp_login']);
  reset_password($user, $_POST['pass']);
}` })
    expect(vuln.taint).toContain("account@a.php:5")
    expect(fixed.taint).not.toContain("account@a.php:4")
  })

  it("public AJAX handler writing an option the request names, unless capability-checked", () => {
    const open = scan({ "p.php": `<?php
add_action('wp_ajax_nopriv_save', 'my_save');
function my_save() { update_option($_POST['key'], $_POST['value']); }` })
    const guarded = scan({ "p.php": `<?php
add_action('wp_ajax_nopriv_save', 'my_save');
function my_save() { check_ajax_referer('save'); if (!current_user_can('manage_options')) wp_die(); update_option($_POST['key'], $_POST['value']); }` })
    const noNonce = scan({ "p.php": `<?php
add_action('wp_ajax_save', 'my_save');
function my_save() { if (!current_user_can('manage_options')) wp_die(); update_option($_POST['key'], $_POST['value']); }` })
    const prefixed = scan({ "p.php": `<?php
add_action('wp_ajax_nopriv_dismiss', 'my_dismiss');
function my_dismiss() { update_option('my_plugin_dismissed_' . $_POST['id'], 1); }` })
    const fixedName = scan({ "p.php": `<?php
add_action('wp_ajax_nopriv_like', 'my_like');
function my_like() { update_option('likes', (int) get_option('likes') + 1); }` })
    expect(open.authz).toEqual(["update_option()@p.php:3"])
    expect(guarded.authz).toEqual([])
    expect(noNonce.authz).toEqual(["csrf:update_option()@p.php:3"])
    expect(prefixed.authz).toEqual([])
    expect(fixedName.authz).toEqual([])
  })

  it("REST route with __return_true reaching a request-named file write", () => {
    const { authz } = scan({ "r.php": `<?php
register_rest_route('x/v1', '/save', array('methods' => 'POST', 'callback' => 'x_save', 'permission_callback' => '__return_true'));
function x_save($request) { file_put_contents($request['path'], $request['body']); }` })
    expect(authz).toEqual(["file_put_contents()@r.php:3"])
  })

  it("logic flaws: ignored checks, redirect without exit, loose secret compare, weak tokens, magic switch", () => {
    const { logic } = scan({ "l.php": `<?php
function a() { wp_verify_nonce($_POST['n'], 'save'); update_option('x', 1); }
function b() { if (!current_user_can('manage_options')) { wp_redirect(admin_url()); } delete_option('x'); }
function c() { if ($_GET['token'] == get_option('api_token')) { echo 'ok'; } }
function d() { $reset_key = md5(uniqid()); }
function e() { if (isset($_GET['letmein']) && $_GET['letmein'] == 'opensesame') { wp_set_auth_cookie(1); } }
function ok() { if (!current_user_can('x')) { wp_redirect('/'); exit; } $api_key = wp_generate_password(32); if (hash_equals(get_option('t'), $_GET['t'])) {} }` })
    expect(logic.sort()).toEqual([
      "guard-falls-through@l.php:3",
      "ignored-check@l.php:2",
      "loose-secret-compare@l.php:4",
      "magic-switch@l.php:6",
      "predictable-token@l.php:5",
    ])
  })

  it("mass assignment and roles chosen by the request", () => {
    const { taint } = scan({ "u.php": `<?php
function reg() { wp_insert_user($_POST); }
function reg2() { $data = ['user_login' => $_POST['login'], 'role' => $_POST['role']]; wp_insert_user($data); }
function reg3() { $u = new WP_User(5); $u->set_role($_REQUEST['r']); }
function ok() { wp_insert_user(['user_login' => sanitize_user($_POST['login']), 'role' => 'subscriber']); }` })
    expect(taint.sort()).toEqual(["privesc@u.php:2", "privesc@u.php:3", "privesc@u.php:4"])
  })

  it("shortcode attributes are author-controlled input", () => {
    const { taint } = scan({ "s.php": `<?php
add_shortcode('show', 'show_sc');
function show_sc($atts) { include plugin_dir_path(__FILE__) . 'tpl/' . $atts['template'] . '.php'; }` })
    expect(taint).toEqual(["include@s.php:3"])
  })

  it("constants defined from headers reach include (CVE-2023-6553 shape)", () => {
    const { taint } = scan({ "heart.php": `<?php
$fields = getallheaders();
define('ROOT_DIR', $fields['content-dir']);
require_once ROOT_DIR . '/bypasser.php';` })
    expect(taint).toContain("include@heart.php:4")
  })
})

describe("php-taint quoting", () => {
  it("escaped values inside LIKE '%…%' are quoted; bare ones are not", () => {
    const p = new Project()
    p.add("q.php", `<?php
$s = esc_sql($_POST['s']);
$wpdb->get_results("SELECT id FROM t WHERE name LIKE '%$s%'");
$wpdb->get_results("SELECT id FROM t WHERE id = $s");
$like = '%' . $wpdb->esc_like($_POST['q']) . '%';
$wpdb->get_results("SELECT id FROM t WHERE title LIKE '{$like}'");`)
    p.run()
    expect(p.findings.map((f) => `${f.kind}:${f.line}`).sort()).toEqual(["sql:4", "sql:6"])
  })
})

describe("php-taint fixes that must be recognised", () => {
  it("path containment check after realpath", () => {
    const p = new Project()
    p.add("d.php", `<?php
function del() {
  $base = realpath(WP_CONTENT_DIR . '/files');
  $path = realpath($base . '/' . $_POST['f']);
  if (strpos($path, $base) !== 0) { return; }
  unlink($path);
}
function del_bad() { unlink(WP_CONTENT_DIR . '/files/' . $_POST['f']); }
function del_alias() {
  $file = WP_CONTENT_DIR . '/files/' . $_POST['f'];
  $real = realpath($file);
  if (!$real || strpos($real, WP_CONTENT_DIR . '/files') !== 0) { return; }
  unlink($file);
}`)
    p.run()
    expect(p.findings.map((f) => `${f.kind}:${f.line}`)).toEqual(["file:8"])
  })

  it("upload with wp_check_filetype before the move is not unrestricted", () => {
    const p = new Project()
    p.add("u.php", `<?php
function up() {
  $name = $_FILES['pic']['name'];
  $check = wp_check_filetype($name);
  if ($check['type']) { move_uploaded_file($_FILES['pic']['tmp_name'], $dir . '/' . $name); }
}
function up_bad() { move_uploaded_file($_FILES['pic']['tmp_name'], $dir . '/' . $_FILES['pic']['name']); }`)
    p.run()
    expect(p.findings.map((f) => `${f.kind}:${f.line}`)).toEqual(["upload:7"])
  })

  it("checking the client-sent MIME type is not a fix (CVE-2024-43243 shape)", () => {
    const p = new Project()
    p.add("m.php", `<?php
function up() {
  $t = $_FILES['pic']['type'];
  if (in_array($t, get_allowed_mime_types())) { move_uploaded_file($_FILES['pic']['tmp_name'], $dir . '/' . $_FILES['pic']['name']); }
}`)
    p.run()
    expect(p.findings.map((f) => `${f.kind}:${f.line}`)).toEqual(["upload:4"])
  })

  it("a content check with the client's file name is not a fix (polyglot x.php)", () => {
    const p = new Project()
    p.add("n.php", `<?php
function up() {
  $t = mime_content_type($_FILES['pic']['tmp_name']);
  if (in_array($t, get_allowed_mime_types())) { move_uploaded_file($_FILES['pic']['tmp_name'], $dir . '/' . sanitize_file_name($_FILES['pic']['name'])); }
}
function up_ext() {
  $ext = strtolower(pathinfo($_FILES['pic']['name'], PATHINFO_EXTENSION));
  if (in_array($ext, ['jpg', 'png'], true)) { move_uploaded_file($_FILES['pic']['tmp_name'], $dir . '/' . $_FILES['pic']['name']); }
}`)
    p.run()
    expect(p.findings.map((f) => `${f.kind}:${f.line}`)).toEqual(["upload:4"])
  })

  it("is_admin() is not a permission check", () => {
    const p = new Project()
    p.add("a.php", `<?php
function save() { if (is_admin()) { update_option('x_settings', $_POST['settings']); } }
function ok() { if (is_admin() && current_user_can('manage_options')) { update_option('x_settings', $_POST['settings']); } }`)
    p.run()
    expect(auditLogic(p).filter((l) => l.kind === "is-admin-as-auth").map((l) => l.line)).toEqual([2])
  })
})

describe("flow graph", () => {
  it("reports source → steps → sink as structured flow", async () => {
    const { phpTaintScanner } = await import("../../src/scanners/php-taint")
    const { makeContext } = await import("../helpers")
    const issues = await phpTaintScanner.run(makeContext({ files: {
      "low.php": "<?php\n$name = $_GET['name'];\n$html = '<pre>Hello ' . $name . '</pre>';\necho $html;\n",
    } }))
    const xss = issues.find((i) => i.flow?.length)
    expect(xss?.flow?.[0]).toMatchObject({ role: "source" })
    expect(xss?.flow?.at(-1)).toMatchObject({ role: "sink", file: "low.php", line: 4 })
    expect(xss?.flow?.map((s) => s.text).join(" → ")).toContain("$_GET")
  })
})
