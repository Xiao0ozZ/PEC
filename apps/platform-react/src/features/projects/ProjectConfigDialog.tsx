import { useMemo, useState } from 'react';

import type { ProjectManifest } from '../../../../../packages/platform-contracts/src/index.js';
import {
  applyClientPreset,
  buildProjectPayload,
  clientPresets,
  createClient,
  draftFromProject,
  getClientPreset,
  projectSlug,
  type ClientDraft,
  type ClientPreset,
  type ProjectDraft,
} from './project-config-model';
import { Alert, Button, ColorPicker, Form, Input, Menu, Modal, Select, Switch, Typography } from '@/ui/ant';
import { AppstoreOutlined, PlusOutlined, SettingOutlined } from '@/ui/ant/icons';

const { Text, Title } = Typography;

type DialogMode = 'create' | 'edit';
interface ProjectConfigDialogProps {
  open: boolean;
  mode: DialogMode;
  project: ProjectManifest | null;
  projectIds: string[];
  saving?: boolean;
  onCancel: () => void;
  onSave: (payload: ReturnType<typeof buildProjectPayload>) => Promise<void>;
}

export function ProjectConfigDialog({
  open,
  mode,
  project,
  projectIds,
  saving = false,
  onCancel,
  onSave,
}: ProjectConfigDialogProps) {
  const [section, setSection] = useState<'project' | 'clients'>('project');
  const [draft, setDraft] = useState<ProjectDraft>(() => draftFromProject(project));
  const [error, setError] = useState('');
  const editing = mode === 'edit';
  const title = editing ? '编辑项目' : '新建项目';

  const clientIds = useMemo(() => new Set(draft.clients.map((client) => client.id)), [draft.clients]);

  function updateDraft(patch: Partial<ProjectDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function updateClient(index: number, next: ClientDraft) {
    setDraft((current) => ({
      ...current,
      clients: current.clients.map((client, currentIndex) => (currentIndex === index ? next : client)),
    }));
  }

  function addClient() {
    let nextIndex = draft.clients.length + 1;
    let nextId = `client-${nextIndex}`;
    while (clientIds.has(nextId)) {
      nextIndex += 1;
      nextId = `client-${nextIndex}`;
    }
    setDraft((current) => ({
      ...current,
      clients: [...current.clients, { ...createClient(nextIndex), id: nextId }],
    }));
  }

  function removeClient(index: number) {
    if (draft.clients.length <= 1) {
      setError('项目至少需要保留一个客户端。');
      return;
    }
    setDraft((current) => ({
      ...current,
      clients: current.clients.filter((_, currentIndex) => currentIndex !== index),
    }));
  }

  async function submit() {
    if (!draft.name.trim()) {
      setError('请输入项目名称。');
      setSection('project');
      return;
    }
    if (!/^#[0-9a-f]{6}$/iu.test(draft.primary)) {
      setError('主题色必须使用六位十六进制色值，例如 #2563eb。');
      setSection('project');
      return;
    }
    if (draft.clients.some((client) => !client.name.trim())) {
      setError('请填写所有客户端名称。');
      setSection('clients');
      return;
    }
    if (!editing && projectIds.includes(projectSlug(draft.name))) {
      setError('该项目 ID 已存在，请调整项目名称后再保存。');
      return;
    }
    setError('');
    await onSave(buildProjectPayload(draft, editing));
  }

  return (
    <Modal
      className="project-config-modal"
      width={980}
      open={open}
      maskClosable={false}
      title={title}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      onCancel={onCancel}
      onOk={() => void submit()}
      destroyOnHidden
    >
      <div className="project-config-shell">
        <Text className="project-config-intro" type="secondary">
          只设置项目内容入口，其他工程参数由平台自动处理。
        </Text>
        {error ? <Alert showIcon type="error" title={error} /> : null}
        <div className="project-config-body">
          <aside className="project-config-nav">
            <Menu
              mode="inline"
              selectedKeys={[section]}
              items={[
                { key: 'project', icon: <SettingOutlined />, label: '项目资料' },
                { key: 'clients', icon: <AppstoreOutlined />, label: `客户端（${draft.clients.length}）` },
              ]}
              onClick={({ key }) => setSection(key as 'project' | 'clients')}
            />
          </aside>
          <main className="project-config-content">
            {section === 'project' ? (
              <section className="project-config-section">
                <div className="project-config-section__heading">
                  <Title level={3}>项目资料</Title>
                  <Text type="secondary">设置项目名称、文档来源和统一主题色。</Text>
                </div>
                <Form layout="vertical" requiredMark={false}>
                  <div className="project-config-grid">
                    <Form.Item label="项目名称" required>
                      <Input
                        value={draft.name}
                        maxLength={60}
                        placeholder="例如：客户服务平台"
                        onChange={(event) => updateDraft({ name: event.target.value })}
                      />
                      {!editing ? <small>项目 ID、简称和版本由平台自动生成。</small> : null}
                    </Form.Item>
                    <Form.Item label="PRD 文件夹">
                      <Input
                        value={draft.docsRoot}
                        allowClear
                        placeholder="填写项目内目录或本机绝对路径；没有可留空"
                        onChange={(event) => updateDraft({ docsRoot: event.target.value })}
                      />
                      <small>填写后启用文档中心；清空则不显示文档入口。</small>
                    </Form.Item>
                  </div>
                  <div className="project-config-grid project-config-grid--divide">
                    <Form.Item label="项目主题色" required>
                      <Input
                        value={draft.primary}
                        maxLength={7}
                        placeholder="#2563eb"
                        onChange={(event) => updateDraft({ primary: event.target.value })}
                        prefix={
                          <ColorPicker
                            value={draft.primary}
                            format="hex"
                            onChange={(_color, hex) => updateDraft({ primary: hex })}
                          />
                        }
                      />
                      <small>用于客户端外壳、主要按钮、链接和选中状态。</small>
                    </Form.Item>
                    <div className="project-visibility-row">
                      <div>
                        <strong>在首页显示项目</strong>
                        <Text type="secondary">关闭后，项目不会出现在首页的项目选择列表中。</Text>
                      </div>
                      <Switch
                        checked={draft.homepageVisible}
                        onChange={(homepageVisible) => updateDraft({ homepageVisible })}
                      />
                    </div>
                  </div>
                </Form>
              </section>
            ) : (
              <section className="project-config-section">
                <div className="project-config-section__heading project-config-section__heading--action">
                  <div>
                    <Title level={3}>客户端</Title>
                    <Text type="secondary">每个客户端只需确定名称、页面结构和内容来源。</Text>
                  </div>
                  <Button icon={<PlusOutlined />} onClick={addClient}>
                    添加客户端
                  </Button>
                </div>
                <div className="project-client-list">
                  {draft.clients.map((client, index) => {
                    const preset = getClientPreset(client);
                    return (
                      <article key={client.id} className="project-client-item">
                        <header>
                          <div>
                            <span>{String(index + 1).padStart(2, '0')}</span>
                            <strong>{client.name.trim() || `客户端 ${index + 1}`}</strong>
                          </div>
                          <div className="project-client-item__actions">
                            <label>
                              首页显示{' '}
                              <Switch
                                size="small"
                                checked={client.entryEnabled}
                                onChange={(entryEnabled) => updateClient(index, { ...client, entryEnabled })}
                              />
                            </label>
                            {draft.clients.length > 1 ? (
                              <Button danger type="link" onClick={() => removeClient(index)}>
                                移除
                              </Button>
                            ) : null}
                          </div>
                        </header>
                        <Form layout="vertical" requiredMark={false}>
                          <div className="project-client-grid">
                            <Form.Item label="客户端名称">
                              <Input
                                value={client.name}
                                placeholder="例如：营运端"
                                onChange={(event) =>
                                  updateClient(index, { ...client, name: event.target.value })
                                }
                              />
                            </Form.Item>
                            <Form.Item label="页面结构">
                              <Select
                                value={preset}
                                options={
                                  preset === 'custom'
                                    ? [...clientPresets, { value: 'custom', label: '保留现有自定义入口' }]
                                    : clientPresets
                                }
                                onChange={(value) =>
                                  value !== 'custom' &&
                                  updateClient(
                                    index,
                                    applyClientPreset(client, value as Exclude<ClientPreset, 'custom'>),
                                  )
                                }
                              />
                            </Form.Item>
                            <Form.Item label="HTML 页面文件夹">
                              <Input
                                value={client.prototypeRoot}
                                allowClear
                                placeholder="使用工程页面时留空"
                                onChange={(event) =>
                                  updateClient(index, { ...client, prototypeRoot: event.target.value })
                                }
                              />
                            </Form.Item>
                          </div>
                        </Form>
                        <small>
                          {clientPresets.find((item) => item.value === preset)?.description ||
                            '当前项目使用已有的自定义入口页面，保存时会原样保留。'}
                        </small>
                      </article>
                    );
                  })}
                </div>
              </section>
            )}
          </main>
        </div>
      </div>
    </Modal>
  );
}
