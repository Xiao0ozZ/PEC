import { expect, test } from '@playwright/test';
import { projectConfig } from '../../src/config/project.config';
import { installStableBrowserState, waitForPrototypeReady } from './test-helpers';

test.describe('关键演示交互', () => {
  test.beforeEach(async ({ page }) => {
    await installStableBrowserState(page);
  });

  test('营运端默认账号可以进入工作台', async ({ page }) => {
    test.setTimeout(60_000);
    await waitForPrototypeReady(page, '/p/rimo-rental/operation/login');
    const loginButton = page.getByRole('button', { name: '登录', exact: true });
    await expect(loginButton).toBeVisible();
    await expect(loginButton).not.toHaveText('');
    await loginButton.click();
    await expect(page).toHaveURL(/\/p\/rimo-rental\/operation\/workbench$/);
  });

  test('客户端切换会进入目标客户端登录页', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/operation/workbench');
    await page.locator('.client-switch').click();
    await page.getByRole('option', { name: '企业端' }).click();
    await expect(page).toHaveURL(/\/p\/rimo-rental\/enterprise\/login$/);
  });

  test('退出登录会返回当前客户端登录页', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/enterprise/dashboard');
    await page.locator('.user-pill').click();
    await page.getByText('退出登录', { exact: true }).click();
    await expect(page).toHaveURL(/\/p\/rimo-rental\/enterprise\/login$/);
  });

  test('平台账户管理可以打开新增员工弹窗', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/operation/employees');
    const addButton = page.getByRole('button', { name: '新增员工', exact: true });
    await expect(addButton).toBeVisible();
    await addButton.click();
    await expect(page.getByRole('dialog')).toContainText('新增员工');
  });

  test('行销方案管理可以打开门市方案配置抽屉', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/operation/marketing');
    await page.getByRole('button', { name: '新建门市方案', exact: true }).first().click();
    await expect(page.locator('.el-drawer')).toContainText('配置门市优惠方案');
  });

  test('新增公务订单可以打开员工选择弹窗', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/enterprise/official-order-add');
    const selectButton = page.getByRole('button', { name: '选择员工', exact: true });
    await expect(selectButton).toBeVisible();
    await expect(selectButton).not.toHaveText('');
    await selectButton.click();
    await expect(page.getByRole('dialog')).toContainText('选择员工');
  });

  test('公务订单管理可以进入新增订单页面', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/enterprise/official-order');
    await page.getByRole('link', { name: '新增订单', exact: true }).click();
    await expect(page).toHaveURL(/\/p\/rimo-rental\/enterprise\/official-order-add$/);
  });

  test('预约审批设定提交后显示保存反馈', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/enterprise/approval-setting');
    await page.getByRole('button', { name: '提交', exact: true }).click();
    await expect(page.locator('.el-message')).toContainText('审批设定已保存');
  });

  test('分公司和部门管理筛选会更新列表', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/enterprise/branch-company-management');
    await page.getByPlaceholder('分公司名称').fill('启迪');
    await expect(page.locator('.branch-company-table .el-table__body tbody tr')).toHaveCount(1);

    await waitForPrototypeReady(page, '/p/rimo-rental/enterprise/department-management');
    await page.getByPlaceholder('部门名称').fill('运营');
    await expect(page.locator('.department-table .el-table__body tbody tr')).toHaveCount(1);
  });

  test('员工管理筛选会同步统计结果', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/enterprise/employee-management');
    await page.getByPlaceholder('姓名/手机号/Email/身份证字号').fill('林雅婷');
    await expect(page.locator('.employee-table .el-table__body tbody tr')).toHaveCount(1);
    await expect(page.locator('.search-result-summary')).toContainText('租用次数：4');
  });

  test('员工申请可以执行单笔审核', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/enterprise/employee-review');
    const firstName = page.locator('.review-table .el-table__body tbody tr').first().locator('td').nth(1);
    await expect(firstName).toContainText('张志明');
    await page.getByRole('button', { name: '审核通过', exact: true }).first().click();
    await expect(page.locator('.el-message')).toContainText('已通过 1 笔员工申请');
    await expect(page.locator('.review-table')).not.toContainText('张志明');
  });

  test('车辆使用范围可以打开新增设定弹窗', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/enterprise/car-use-management');
    await page.getByRole('button', { name: '新增', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('新增用车设定');
  });

  test('公务车账单操作会显示反馈', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/enterprise/official-car-bill');
    await page.getByRole('button', { name: '历史账单', exact: true }).click();
    await expect(page.locator('.el-message')).toContainText('当前列表已包含历史账单');
  });

  test('新增公务车可以同步带入车辆基础资料', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/enterprise/official-vehicle-add');
    await page.getByRole('button', { name: '同步带入', exact: true }).click();
    await expect(page.locator('.el-message')).toContainText('已同步带入车款基础资料');
    await expect(page.getByPlaceholder('请输入车辆名称或内部识别名称')).toHaveValue('台北公务车-待建');
  });

  test('清洁保养提醒可以打开完整设定弹窗', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/enterprise/official-vehicle-reminders');
    await page.getByRole('button', { name: '设定', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('清洁保养提醒设定');
    await expect(dialog).toContainText('保养母版');
    await expect(dialog).toContainText('车辆套用');
  });

  test('企业仪表板可以查看总览字段说明', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/enterprise/dashboard');
    await page.getByRole('button', { name: '欄位說明', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('欄位說明');
  });

  test('企业租车券列表和详情可以互相跳转', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/enterprise/channel-ticket-batches');
    await page.getByRole('button', { name: '查看详情', exact: true }).first().click();
    await expect(page).toHaveURL(/\/p\/rimo-rental\/enterprise\/channel-ticket-batch-detail\?id=1$/);
    await expect(page.getByRole('heading', { name: '金门 5 月 A 团租車券' })).toBeVisible();
    await page.getByRole('button', { name: '返回列表', exact: true }).click();
    await expect(page).toHaveURL(/\/p\/rimo-rental\/enterprise\/channel-ticket-batches$/);
  });

  test('个人会员列表和详情可以互相跳转', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/operation/members');
    await page.getByRole('button', { name: '详情', exact: true }).first().click();
    await expect(page).toHaveURL(/\/p\/rimo-rental\/operation\/member-detail\?id=/);
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await expect(page).toHaveURL(/\/p\/rimo-rental\/operation\/members$/);
  });

  test('企业客户列表和详情可以互相跳转', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/operation/corporates');
    await page.getByRole('button', { name: '查看', exact: true }).first().click();
    await expect(page).toHaveURL(/\/p\/rimo-rental\/operation\/corporate-detail\?id=/);
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await expect(page).toHaveURL(/\/p\/rimo-rental\/operation\/corporates$/);
  });

  test('会员审核可以打开审核抽屉和统一提交弹窗', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/operation/member-review');
    await page.getByRole('button', { name: '审核', exact: true }).first().click();
    await expect(page.locator('.el-drawer')).toContainText('提交审核');
    await page.getByRole('button', { name: '提交审核', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '提交审核' })).toContainText('用户可用载具类型');
  });

  test('客户等级方案和权限管理可以打开新增弹窗', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/operation/membership-plans');
    await page.getByRole('button', { name: '新增方案', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('新增会员方案');

    await waitForPrototypeReady(page, '/p/rimo-rental/operation/permissions');
    await page.getByRole('button', { name: '新增', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('新增角色');
  });

  test('系统通用参数可以查看 AI 调用日志', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/operation/system-rules');
    await page.getByText('AI模型接入', { exact: true }).click();
    await page.getByRole('button', { name: '查看日志', exact: true }).first().click();
    await expect(page.getByRole('dialog')).toContainText('AI调用请求日志');
  });

  test('基础产品定价和动态调价可以打开新增配置弹窗', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/operation/service-products');
    await page.getByRole('button', { name: '新增产品组', exact: true }).first().click();
    await expect(page.getByRole('dialog')).toContainText('新增门市租赁产品组');

    await waitForPrototypeReady(page, '/p/rimo-rental/operation/pricing');
    await page.getByRole('button', { name: '新增计划', exact: true }).first().click();
    await expect(page.getByRole('dialog')).toContainText('新增门市调价计划');
  });

  test('增值服务和租赁业务规则可以打开完整配置弹窗', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/operation/services');
    await page.getByRole('button', { name: '新增门市服务', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('新增门市服务');

    await waitForPrototypeReady(page, '/p/rimo-rental/operation/settings');
    await page.getByRole('button', { name: '历史版本', exact: true }).first().click();
    await expect(page.getByRole('dialog')).toContainText('门市租车规则历史版本');
  });

  test('租车券申报可以打开审批弹窗', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/operation/channel-ticket-applications');
    await page.getByRole('button', { name: '审批', exact: true }).first().click();
    await expect(page.getByRole('dialog')).toContainText('审批批次申报');
  });

  test('营运端租车券列表和详情可以互相跳转', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/operation/channel-ticket-batches');
    await page.getByRole('button', { name: '查看详情', exact: true }).first().click();
    await expect(page).toHaveURL(/\/p\/rimo-rental\/operation\/channel-ticket-batch-detail\?id=/);
    await page.getByRole('button', { name: '返回列表', exact: true }).click();
    await expect(page).toHaveURL(/\/p\/rimo-rental\/operation\/channel-ticket-batches$/);
  });

  test('门市订单统计卡片和分页可以正常使用', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/operation/store-orders');
    await page.getByRole('button', { name: '运营总览', exact: true }).click();
    const allOrdersCard = page.getByRole('button', { name: /全部订单/ });
    await expect(allOrdersCard).toBeVisible();
    await allOrdersCard.click();
    await expect(allOrdersCard).toHaveClass(/border-theme-primary/);
    await expect(page.locator('.el-pagination')).toBeVisible();
  });

  test('门市订单可以进入详情并打开费用与备注弹窗', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/operation/store-orders');
    await page.getByRole('button', { name: '详情', exact: true }).first().click();
    await expect(page).toHaveURL(/\/p\/rimo-rental\/operation\/order-detail\?id=/);

    await page.getByRole('button', { name: '费用', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '费用管理' })).toContainText('订单费用台账');
    await page.getByRole('dialog', { name: '费用管理' }).getByRole('button', { name: 'Close' }).click();

    await page.getByRole('button', { name: '更多操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '订单备注', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '订单备注' })).toBeVisible();
  });

  test('分时订单可以进入详情并返回订单列表', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/operation/time-share-orders');
    await page.getByRole('button', { name: '详情', exact: true }).first().click();
    await expect(page).toHaveURL(/\/p\/rimo-rental\/operation\/order-detail\?id=/);
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await expect(page).toHaveURL(/\/p\/rimo-rental\/operation\/store-orders$/);
  });

  test('门市订单可以进入新增订单页面', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/operation/store-orders');
    await page.locator('.el-dropdown__caret-button').first().click();
    await page.getByRole('menuitem', { name: '新建门市租赁订单', exact: true }).click();
    await expect(page).toHaveURL(/\/p\/rimo-rental\/operation\/new-order\?type=store$/);
    await expect(page.locator('.new-order-page')).toBeVisible();
    await expect(page.getByText('客户信息', { exact: true })).toBeVisible();
  });

  test('车辆排程看板可以打开智能优化配置', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/operation/dispatch');
    await page.getByRole('button', { name: '智能优化', exact: true }).click();
    await expect(page.locator('.el-dialog')).toContainText('智能优化排班');
    await expect(page.locator('.el-dialog')).toContainText('优化时间窗口');
  });

  test('车辆调拨可以打开单车快捷调拨抽屉', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/operation/vehicle-transfer');
    await page.getByRole('button', { name: '快捷调度', exact: true }).first().click();
    const drawer = page.locator('.el-drawer');
    await expect(drawer).toContainText('单车快捷调拨');
    await expect(drawer).toContainText('目标类型');
  });

  test('车辆档案库可以打开新增车辆和详情', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/operation/vehicles');
    await page.getByRole('button', { name: '新增车辆', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('新增车辆');
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '详情', exact: true }).first().click();
    await expect(page.locator('.el-drawer')).toContainText('基础档案');
  });

  test('车型组和车机设定可以打开新增与绑定弹窗', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/operation/vehicle-groups');
    await page.getByRole('button', { name: '新增车型组', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('新增车型组');

    await waitForPrototypeReady(page, '/p/rimo-rental/operation/tbox-management');
    await page.getByRole('button', { name: '绑定车辆', exact: true }).first().click();
    await expect(page.getByRole('dialog')).toContainText('车机绑定操作');
  });

  test('服务据点管理可以打开新增据点和组织架构弹窗', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/operation/stations');
    await page.getByRole('button', { name: '新增据点', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('新增据点');
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '管理层级', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('管理组织架构');
  });

  test('工作台可以打开待办事项总览', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/operation/workbench');
    await page.getByRole('link', { name: /全部/ }).last().click();
    await expect(page.getByRole('dialog')).toContainText('待办事项总览');
  });

  test('综合仪表板可以自动打开系统提醒中心', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/operation/dashboard');
    await expect(page.getByRole('dialog', { name: '系统提醒中心' })).toBeVisible();
  });

  test('公务车辆合约管理可以打开新签合约弹窗', async ({ page }) => {
    await waitForPrototypeReady(page, '/p/rimo-rental/operation/official-vehicle-contracts');
    await page.getByRole('button', { name: '新签合约', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('新建公务车合约');
    await expect(page.getByRole('dialog')).toContainText('实际用车企业');
  });

  test('文档中心可以读取文档并搜索目录', async ({ page }) => {
    await waitForPrototypeReady(
      page,
      `/docs?file=${encodeURIComponent('门市租赁/门市租赁端到端业务流程.md')}`,
    );
    await expect(page.locator('.markdown-body h1').first()).toBeVisible();
    const search = page.getByPlaceholder('搜索文件名或路径').first();
    await search.fill('订单详情');
    await expect(page.locator('.document-tree').first()).toContainText('订单详情');
  });

  test('未知地址显示 404 并可返回首页', async ({ page }) => {
    await waitForPrototypeReady(page, '/not-a-real-page');
    await expect(page.getByRole('heading', { name: '页面不存在' })).toBeVisible();
    await expect(page).toHaveTitle(`页面不存在 - ${projectConfig.name}`);
    await page.getByRole('link', { name: '返回项目首页' }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('组件规范页可以演示公共组件交互', async ({ page }) => {
    await waitForPrototypeReady(page, '/components');
    const pendingCard = page.getByRole('button', { name: /待处理/ });
    await pendingCard.click();
    await expect(pendingCard).toHaveAttribute('aria-pressed', 'true');
    await pendingCard.click();
    await expect(pendingCard).toHaveAttribute('aria-pressed', 'false');

    await page.getByPlaceholder('订单号 / 客户名称').fill('测试');
    await page.getByRole('button', { name: '重置筛选', exact: true }).click();
    await expect(page.getByPlaceholder('订单号 / 客户名称')).toHaveValue('');

    await page.getByRole('button', { name: '新增示例', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('新增示例');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
