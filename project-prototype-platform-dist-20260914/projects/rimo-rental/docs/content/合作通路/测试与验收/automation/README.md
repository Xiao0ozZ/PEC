# 合作通路租車券自动化脚本

## 当前能力

- 读取Git忽略的 `.env.test.local`。
- 检查必要环境变量是否齐全。
- 检查管理后台Swagger、APP Swagger、营运端和企业端是否可以访问。
- 输出不包含账号密码和Token的预检结果。
- 保存依据当前PRD和HTML原型整理的UI页面契约和测试数据模板。
- 保存从当前Swagger确认的API路径和复用关系。
- 校验完整用例库的编号、数量和UI契约引用关系。
- 执行APP独立只读冒烟、管理端和企业端只读冒烟、测试数据发现、数量生成主流程、现有批次状态、导出和现有订单费用归属审计。名单追加属于破坏性单项测试，不纳入默认整轮回归。

完整API执行顺序及APP独立执行边界统一维护在 `../02_自动化测试执行方案.md`，当前结果统一维护在 `../04_测试状态与交接记录.md`。本文件不得追加缺陷、通过数、阻断情况或历次执行结果。

APP接口测试单独维护。`test:app`只执行APP接口脚本，不调用营运端或企业端接口；`smoke:app`作为兼容旧命令保留。

新增或调整业务脚本时，必须沿用执行方案中的步骤编号和统一运行上下文，明确上一步输出如何作为下一步输入；不得通过硬编码第一条列表数据绕过对象关联。Swagger的`required`只作为初始契约，写接口必须区分字段缺省、JSON `null`、空字符串、非法值和多字段组合，并以完整基线请求做单字段/组合隔离。

凡涉及本地文件选择或上传，统一由人工在Codex内置浏览器中完成。Playwright脚本最多打开上传窗口并验证上传控件，不调用`filechooser.setFiles`、不读取本地文件，也不通过环境变量自动上传。人工上传并确认后，再继续执行导入、提交和结果回查。

## 测试数据规则

- 所属合作企业固定为“租车券测试公司”，由 `TEST_COOPERATIVE_COMPANY_NAME` 按名称精确匹配；找不到时直接阻断，不回退到其他企业。
- 数量生成主流程固定复用 `TEST_QUANTITY_BATCH_NAME` 对应的一个未过期批次；不存在或已过期时默认阻断。只有明确要求完成正向测试时才允许补建一条固定名称的替代批次。
- 名单流程只使用“租车券测试公司”名下的待导入名单批次；没有可复测批次时标记阻断，不自动新建第二批名单数据。
- 一轮测试最多保留一条名单批次和一条数量批次。历史 `AUTO-CT-QTY-*` 批次没有删除接口，脚本不删除历史数据，后续也不再新增同类重复批次。

## 运行

推荐使用整轮启动器。它先独立执行APP接口，再建立一次营运端和企业端授权；后续管理端子测试通过进程内环境传递 Token，不重复登录：

```text
npm run test:regression
```

如果环境中已经存在 `RIMO_MANAGE_TOKEN`、`RIMO_ENTERPRISE_TOKEN` 或 `RIMO_APP_TOKEN`，启动器直接复用，不会重新登录。Token 只存在于本轮测试进程和子进程内，不写入文件、报告或终端输出。

在非交互终端中缺少营运端或企业端 Token 时，完整回归会在APP接口完成后明确标记管理端阻断，不再自动生成验证码文件。交互终端仍可各输入一次验证码；也可通过 `RIMO_CAPTCHA_SESSION` / `RIMO_CAPTCHA_CODE` 和企业端对应变量注入同一验证码会话。

```text
npm run preflight
npm run validate:plan
npm run smoke:manage
npm run smoke:enterprise
npm run discover:data
npm run test:quantity-flow
npm run test:quantity-exchange
$env:RIMO_QUANTITY_RESERVATION_ONLY='1'; npm run test:app-reservation; Remove-Item Env:RIMO_QUANTITY_RESERVATION_ONLY
npm run test:app-existing-reservation
npm run test:existing-state
npm run test:existing-order
```

指定行销方案时，先设置 `RIMO_MARKETING_PLAN_ID`。脚本会将该参数同时传给租金试算与预约建单；行销方案与车辆组别不匹配时停止在试算阶段，不提交预约。需要验证预约 API 是否独立校验时，额外设置 `RIMO_SKIP_RENT_CALC=1`，仅用于后端校验测试，成功建单后保留订单并登记 Bug。

名单追加会真实增加租車券，只能在准备专用批次和证件号码后单独执行：

```powershell
$env:ALLOW_DESTRUCTIVE_LIST_TEST='CONFIRM'
npm run test:existing-list:destructive
Remove-Item Env:ALLOW_DESTRUCTIVE_LIST_TEST
```

未显式确认时脚本直接返回阻断，不调用追加接口。重复证件号验证成功或失败后均不得在同一批次反复执行。

只测试APP接口时执行：

```text
npm run test:app
```

该命令只复用或建立APP授权，当前执行APP登录、可用租車券数量和我的租車券列表只读检查，不会登录营运端或企业端，也不会创建批次、订单或修改测试数据。后续增加APP用券、据点、车辆、计价和预约接口测试时，继续放在APP独立入口中；若依赖既有批次或租車券，必须使用已准备好的对象，不能因为单独测试APP而自动创建管理端数据。

上面的非破坏性单项命令仍可单独执行；单独执行时优先读取对应的 `RIMO_*_TOKEN`，没有注入 Token 才进入原有登录流程。完整回归优先使用 `npm run test:regression`，避免把各单项命令拆开后重复登录。

`smoke:manage`、`smoke:enterprise`等单项管理端脚本在没有Token时仍需要交互输入验证码；登录成功后删除临时图片。完整回归在非交互终端中不会进入该流程，避免重复生成验证码或无输入挂起。

交互终端无法保持时，先运行 `node scripts/create-captcha-session.mjs operations` 或 `enterprise`，识别图片后使用同一会话执行：

```powershell
$env:RIMO_CAPTCHA_SESSION='test-results/captcha-session-operations.json'
$env:RIMO_CAPTCHA_CODE='验证码'
npm run smoke:manage
Remove-Item Env:RIMO_CAPTCHA_SESSION,Env:RIMO_CAPTCHA_CODE
```

验证码会话文件和图片只用于本次登录，测试结束后删除。

业务脚本退出状态：`0`表示通过，`1`表示发现失败，`2`表示缺少可用前置数据而阻塞。阻塞不得登记为产品缺陷。

公共请求工具仅对 `GET/HEAD` 网络异常最多执行5次并递增等待；写接口不自动重试，是否重放必须先查询业务结果。

注册等写接口每次使用新的测试邮箱、手机号和证件号；成功返回的临时Token只判断是否存在，不输出、不写入报告、不自动继续后续写操作。HTTP 200不代表业务成功，必须同时核对业务`code`和`msg`；记录内部错误时写明触发的字段状态组合。

## 安全规则

- `.env.test.local`不得提交Git。
- 固定测试地址、账号和登录参数由 `../01_自动化测试接入资料填写表.md` 统一维护；`.env.test.local`是供脚本读取的运行副本。
- `env.test.example`只保留字段，不保存凭证。
- 报告不得输出密码、Token和完整数据库连接信息。
- 网页UI测试固定使用Codex内部浏览器，不依赖本机Edge登录态。

## Playwright页面回归

首轮页面流程先用Codex内部浏览器确认，再由Playwright脚本固化。脚本使用独立Chromium上下文，不接管Codex内部浏览器标签页，也不依赖外部Edge登录态。

脚本需要本地登录状态文件；文件放在 `.auth/` 或其他不提交Git的路径。营运端和企业端账号不同，分别设置状态文件：

```powershell
$env:RIMO_UI_OPERATIONS_STATE='.auth/operations.json'
$env:RIMO_UI_ENTERPRISE_STATE='.auth/enterprise.json'
npm run test:ui
```

当前固定测试数据由API流程准备，页面脚本只复用“租车券测试公司”名下的 `AUTO-CT-QTY-數量主流程`，找不到时跳过，不自动创建重复批次。名单批次的Excel上传由人工完成，脚本不代传文件。执行结果和HTML报告写入 `test-results/`；不生成页面截图、Trace或视频作为Bug附件。

## 缺陷记录

- Codex只在本地记录缺陷，不登录或提交飞书。
- 同一天的测试只生成一份 `reports/bugs/{YYYYMMDD}/bug.md`；当天发现的多个Bug集中记录在同一份文件中。
- 每条只记录：缺陷编号、模块/流程、严重程度、问题说明、预期结果、实际结果、是否阻断后续。
- 不生成页面截图、接口附件、控制台日志或单独缺陷目录。
- 用户根据当天的 `bug.md` 手动录入飞书多维表格。
