/**
 * 与存档相关的弹窗：主角设定、状态编辑、NPC、日记生成/查看、导出。
 * 被对话页和存档页复用。
 */

import { STATUS_FIELDS } from '../core/constants.js';
import { demoDiary, demoNpc } from '../core/demo.js';
import {
  FULL_MEMORY_MAX_CHARS,
  MEMORY_STRENGTH_LEVELS,
  getMemoryStrengthMeta,
  normalizeMemoryStrength,
} from '../core/memory-strength.js';
import { extractDiaryText, extractNpcDraft } from '../core/parse.js';
import {
  buildDiaryPrompt,
  buildFullDiaryTranscript,
  buildNpcPrompt,
} from '../core/prompt.js';
import {
  countChars,
  createId,
  downloadJson,
  normalizeUsage,
  sanitizeFileName,
} from '../core/utils.js';
import {
  exportPersonaPayload,
  normalizeProtagonist,
  normalizeStatus,
  personaExportFilename,
} from '../data/schemas.js';
import { completeChat } from '../services/ai.js';
import { h, icon } from './dom.js';
import {
  field as fieldComponent,
  input,
  textarea,
} from './components.js';
import { confirmDialog, openModal } from './modal.js';
import { toast, toastError, toastSuccess } from './toast.js';

function currentSettings(app) {
  const settings = app.store.state.settings;
  return {
    settings,
    apiKey:
      typeof app.getEffectiveApiKey === 'function'
        ? app.getEffectiveApiKey(settings.provider)
        : app.runtime?.apiKeys?.[settings.provider] || '',
  };
}

function recordResult(
  app,
  archiveId,
  provider,
  usage,
  promptText,
  replyText,
  { record = true } = {},
) {
  const normalized = normalizeUsage(usage, promptText, replyText);
  if (record && normalized.totalTokens > 0) {
    app.store.recordUsage({ archiveId, provider, usage: normalized });
  }
  return normalized;
}

function showAIError(app, error, archiveId, context) {
  app.markAIStatus?.('offline', error?.message || '调用失败');
  app.store.logError(`${context}.failed`, error, {
    archiveId,
    detail: {
      code: error.code || '',
      requestId: error.requestId || '',
      model: app.store.state.settings.model,
      provider: app.store.state.settings.provider,
    },
  });
  openModal({
    title: '这次没有连接上',
    eyebrow: 'AI 调用失败',
    size: 'sm',
    body: h(
      'div',
      { class: 'stack-md' },
      h('p', { class: 'modal-message', text: error?.message || '未知错误。' }),
      h('p', {
        class: 'muted small',
        text: error?.hint || '详细错误类型、堆栈与时间戳已写入「运行日记」，可在那里排查。',
      }),
      error?.requestId
        ? h('p', { class: 'code-line', text: `Request ID: ${error.requestId}` })
        : null,
    ),
    actions: [
      {
        label: '去设置',
        variant: 'primary',
        onClick: () => app.navigate('settings'),
      },
      { label: '关闭', variant: 'ghost' },
    ],
  });
}

/* ------------------------------------------------------------------ */
/* 主角设定                                                            */
/* ------------------------------------------------------------------ */

export function openProtagonistEditor(app, archiveId, { onSaved } = {}) {
  const archive = app.store.getArchive(archiveId);
  if (!archive) return null;
  const player = archive.protagonist;
  const extrasContainer = h('div', { class: 'stack-sm' });

  const addExtra = (label = '', value = '') => {
    const row = h('div', { class: 'repeater-row' });
    const labelInput = input({
      placeholder: '字段名，如：随身物品',
      value: label,
      maxLength: 40,
      'aria-label': '自定义字段名',
    });
    const valueInput = input({
      placeholder: '内容',
      value,
      maxLength: 500,
      'aria-label': '自定义字段内容',
    });
    const remove = h(
      'button',
      {
        class: 'icon-btn subtle',
        type: 'button',
        'aria-label': '删除这个字段',
        onclick: () => row.remove(),
      },
      icon('x'),
    );
    row.append(labelInput, valueInput, remove);
    extrasContainer.appendChild(row);
  };

  for (const extra of player.extras || []) addExtra(extra.label, extra.value);

  const nameInput = input({ id: 'player-name', value: player.name, maxLength: 40, required: true });
  const ageInput = input({ id: 'player-age', value: player.age, maxLength: 24, placeholder: '如 25' });
  const identityInput = input({
    id: 'player-identity',
    value: player.identity,
    maxLength: 200,
    placeholder: '如：刚搬到这座城市的编辑',
  });
  const likesInput = textarea({
    id: 'player-likes',
    value: player.likes,
    rows: 3,
    maxLength: 600,
    placeholder: '喜欢的东西、习惯、在意的小事…',
  });

  const form = h(
    'form',
    { class: 'stack-md', onsubmit: (event) => event.preventDefault() },
    h(
      'div',
      { class: 'form-grid two' },
      fieldComponent({ label: '姓名', required: true, control: nameInput, htmlFor: 'player-name' }),
      fieldComponent({ label: '年龄', control: ageInput, htmlFor: 'player-age' }),
    ),
    fieldComponent({ label: '身份', control: identityInput, htmlFor: 'player-identity' }),
    fieldComponent({
      label: '喜好',
      control: likesInput,
      htmlFor: 'player-likes',
      hint: '这些信息会随每轮提示词一起发送，请只写对角色互动有用的部分。',
    }),
    h(
      'div',
      { class: 'form-section' },
      h(
        'div',
        { class: 'form-section-head' },
        h('h3', { class: 'form-section-title', text: '其他自定义字段' }),
        h(
          'button',
          {
            class: 'btn btn-ghost btn-sm',
            type: 'button',
            onclick: () => addExtra(),
          },
          icon('plus'),
          h('span', { text: '添加字段' }),
        ),
      ),
      extrasContainer,
    ),
  );

  return openModal({
    title: '主人公设定',
    eyebrow: `${archive.name} · 你`,
    subtitle: '这些信息会作为背景设定传递给 AI；随时可以修改。',
    size: 'lg',
    body: form,
    actions: [
      { label: '取消', variant: 'ghost' },
      {
        label: '保存主人公',
        variant: 'primary',
        onClick: () => {
          if (!nameInput.value.trim()) {
            nameInput.focus();
            toastError('请填写主人公姓名。');
            return false;
          }
          const extras = Array.from(extrasContainer.querySelectorAll('.repeater-row'))
            .map((row) => {
              const [labelField, valueField] = row.querySelectorAll('input');
              return { label: labelField?.value, value: valueField?.value };
            })
            .filter((extra) => extra.label?.trim() && extra.value?.trim());

          const next = normalizeProtagonist({
            name: nameInput.value,
            age: ageInput.value,
            identity: identityInput.value,
            likes: likesInput.value,
            extras,
          });
          app.store.update(
            (state) => {
              const target = state.archives.find((item) => item.id === archiveId);
              if (target) {
                target.protagonist = next;
                target.updatedAt = new Date().toISOString();
              }
            },
            { reason: 'protagonist-updated', archiveId },
          );
          app.store.info('protagonist.updated', `更新了「${next.name}」的主人公设定。`, {
            archiveId,
          });
          toastSuccess('主人公设定已更新。');
          // 等 <dialog> 完成关闭后再触发页面重绘，避免在原生弹窗关闭过程中重建视图。
          if (onSaved) setTimeout(() => onSaved(next), 0);
        },
      },
    ],
  });
}

/* ------------------------------------------------------------------ */
/* 状态                                                                */
/* ------------------------------------------------------------------ */

export function openStatusEditor(app, archiveId, { onSaved } = {}) {
  const archive = app.store.getArchive(archiveId);
  if (!archive) return null;
  const controls = {};
  const form = h('form', { class: 'stack-md', onsubmit: (event) => event.preventDefault() });

  for (const statusField of STATUS_FIELDS) {
    const value = archive.status?.[statusField.key] || '';
    const control = textarea({
      id: `status-${statusField.key}`,
      value,
      rows: statusField.key === 'notes' ? 5 : 2,
      maxLength: statusField.max,
      placeholder: statusField.key === 'notes' ? '光影、声音、气味、氛围…' : '',
    });
    controls[statusField.key] = control;
    const counter = h('span', {
      class: 'char-counter',
      text: `${countChars(value)} / ${statusField.max}`,
    });
    control.addEventListener('input', () => {
      counter.textContent = `${countChars(control.value)} / ${statusField.max}`;
    });
    form.appendChild(
      fieldComponent({
        label: statusField.label,
        htmlFor: control.id,
        control,
        hint:
          statusField.key === 'notes'
            ? '最多 1000 字。AI 每轮也会尝试更新，这里是你的手动校准。'
            : undefined,
      }),
    );
    form.appendChild(h('div', { class: 'field-counter-row' }, counter));
  }

  return openModal({
    title: '编辑此刻的状态',
    eyebrow: archive.name,
    subtitle: '右侧状态栏会在下一轮对话后继续被 AI 更新。',
    size: 'lg',
    body: form,
    actions: [
      { label: '取消', variant: 'ghost' },
      {
        label: '保存状态',
        variant: 'primary',
        onClick: () => {
          const values = Object.fromEntries(
            Object.entries(controls).map(([key, control]) => [key, control.value]),
          );
          const next = normalizeStatus(
            { ...values, updatedAt: new Date().toISOString(), source: 'manual' },
            archive.status,
          );
          app.store.update(
            (state) => {
              const target = state.archives.find((item) => item.id === archiveId);
              if (target) {
                target.status = next;
                target.updatedAt = new Date().toISOString();
              }
            },
            { reason: 'status-updated', archiveId },
          );
          app.store.info('status.updated', '手动更新了角色状态。', { archiveId });
          toastSuccess('状态已更新。');
          onSaved?.(next);
        },
      },
    ],
  });
}

/* ------------------------------------------------------------------ */
/* NPC                                                                 */
/* ------------------------------------------------------------------ */

export function openNpcEditor(app, archiveId, { prefill = null, onSaved } = {}) {
  const archive = app.store.getArchive(archiveId);
  if (!archive) return null;

  const nameInput = input({
    id: 'npc-name',
    value: prefill?.name || '',
    maxLength: 40,
    required: true,
    placeholder: '如：程野',
  });
  const identityInput = input({
    id: 'npc-identity',
    value: prefill?.identity || '',
    maxLength: 160,
    placeholder: '与场景有关的身份',
  });
  const styleInput = textarea({
    id: 'npc-style',
    value: prefill?.style || '',
    rows: 3,
    maxLength: 500,
    placeholder: '说话方式、行为习惯、与主角的关系…',
  });
  const appearanceInput = textarea({
    id: 'npc-appearance',
    value: prefill?.appearance || '',
    rows: 3,
    maxLength: 500,
    placeholder: '外貌与标志性细节',
  });
  const colorInput = input({
    id: 'npc-color',
    type: 'color',
    value: prefill?.color || '#b8846b',
    class: 'color-input',
  });

  const aiHint = h('p', {
    class: 'muted small',
    text: prefill ? '这是 AI 根据当前场景起草的 NPC，保存前可以任意修改。' : '',
  });
  const aiButton = h(
    'button',
    { class: 'btn btn-soft btn-sm', type: 'button' },
    icon('wand'),
    h('span', { text: prefill ? '重新起草' : 'AI 根据场景起草' }),
  );

  const form = h(
    'form',
    { class: 'stack-md', onsubmit: (event) => event.preventDefault() },
    h(
      'div',
      { class: 'ai-draft-bar' },
      h(
        'div',
        {},
        h('strong', { text: '让新角色自然进入场景' }),
        h('p', { text: '会发送当前场景与最近几轮对话，产生一次较短的非流式调用。' }),
      ),
      aiButton,
    ),
    aiHint,
    h(
      'div',
      { class: 'form-grid two' },
      fieldComponent({ label: '姓名', required: true, control: nameInput, htmlFor: 'npc-name' }),
      fieldComponent({ label: '身份', control: identityInput, htmlFor: 'npc-identity' }),
    ),
    fieldComponent({
      label: '对话风格',
      control: styleInput,
      htmlFor: 'npc-style',
      hint: '会写入后续提示词，决定这个 NPC 怎么说话。',
    }),
    fieldComponent({
      label: '外貌描写',
      control: appearanceInput,
      htmlFor: 'npc-appearance',
    }),
    fieldComponent({ label: '标识色', control: colorInput, htmlFor: 'npc-color' }),
  );

  let modal = null;
  aiButton.addEventListener('click', async () => {
    const { settings, apiKey } = currentSettings(app);
    const archiveNow = app.store.getArchive(archiveId);
    if (!archiveNow) return;
    const prompt = buildNpcPrompt({
      archive: archiveNow,
      persona: app.store.getPersona(archiveNow.personaId),
      worldbook: app.store.getWorldbook(archiveNow.worldbookId),
    });

    aiButton.disabled = true;
    aiButton.classList.add('is-busy');
    modal?.setBusy(true, '正在构思…');
    try {
      let draft;
      let resultModel = 'demo';
      let usage = null;
      let cached = false;
      let promptText = prompt.messages.map((message) => message.content).join('\n');

      if (settings.demoMode) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        draft = demoNpc({ persona: app.store.getPersona(archiveNow.personaId), archive: archiveNow });
      } else {
        const result = await completeChat({
          settings,
          messages: prompt.messages,
          apiKey,
          useCache: true,
          cacheScope: 'npc',
        });
        draft = extractNpcDraft(result.text);
        resultModel = result.model;
        cached = Boolean(result.cached);
        usage = recordResult(
          app,
          archiveId,
          settings.provider,
          result.usage,
          promptText,
          result.text,
          { record: !cached },
        );
        app.markAIStatus?.('online');
      }

      nameInput.value = draft.name;
      identityInput.value = draft.identity;
      styleInput.value = draft.style;
      appearanceInput.value = draft.appearance;
      colorInput.value = draft.color;
      aiHint.textContent = settings.demoMode
        ? '演示模式：这份草稿没有消耗 token，也没有调用真实模型。'
        : `已生成草稿${cached ? '（来自本地缓存）' : usage ? ` · 本次约 ${usage.totalTokens} tokens` : ''}。`;
      app.store.info('npc.drafted', `为存档起草了 NPC「${draft.name}」。`, {
        archiveId,
        detail: { model: resultModel, cached },
      });
    } catch (error) {
      if (error?.code === 'ABORTED') return;
      app.store.logError('npc.draft.failed', error, { archiveId });
      toastError(error?.message || 'AI 起草失败，请手动填写。');
    } finally {
      aiButton.disabled = false;
      aiButton.classList.remove('is-busy');
      modal?.setBusy(false);
    }
  });

  modal = openModal({
    title: '邀请一位新角色',
    eyebrow: archive.name,
    subtitle: 'NPC 可以手动填写，也可以让 AI 根据当前场景起草。',
    size: 'lg',
    body: form,
    actions: [
      { label: '取消', variant: 'ghost' },
      {
        label: '加入场景',
        variant: 'primary',
        onClick: () => {
          if (!nameInput.value.trim()) {
            nameInput.focus();
            toastError('请填写 NPC 姓名。');
            return false;
          }
          const npc = {
            id: createId('npc'),
            name: nameInput.value.trim().slice(0, 40),
            identity: identityInput.value.trim().slice(0, 160) || '身份未设定',
            style: styleInput.value.trim().slice(0, 500),
            appearance: appearanceInput.value.trim().slice(0, 500),
            color: colorInput.value || '#b8846b',
            source: prefill ? 'ai' : 'manual',
            createdAt: new Date().toISOString(),
          };
          app.store.update(
            (state) => {
              const target = state.archives.find((item) => item.id === archiveId);
              if (target) {
                target.npcs.push(npc);
                target.updatedAt = new Date().toISOString();
              }
            },
            { reason: 'npc-added', archiveId },
          );
          app.store.info('npc.added', `NPC「${npc.name}」加入了场景。`, { archiveId });
          toastSuccess(`「${npc.name}」已加入场景。`);
          onSaved?.(npc);
        },
      },
    ],
  });
  return modal;
}

/* ------------------------------------------------------------------ */
/* 日记                                                                */
/* ------------------------------------------------------------------ */

export function openDiaryViewer(app, archiveId) {
  const archive = app.store.getArchive(archiveId);
  if (!archive) return null;

  const diaries = [...archive.diaries].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  );
  const body = diaries.length
    ? h(
        'div',
        { class: 'diary-list' },
        ...diaries.map((diary, index) =>
          h(
            'article',
            { class: 'diary-entry' },
            h(
              'header',
              { class: 'diary-entry-head' },
              h('span', { class: 'diary-index', text: String(diaries.length - index).padStart(2, '0') }),
              h(
                'div',
                {},
                h('h3', {
                  class: 'diary-entry-title',
                  text: new Date(diary.createdAt).toLocaleDateString('zh-CN', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  }),
                }),
                h('p', {
                  class: 'diary-entry-meta',
                  text: `${diary.messageCount || 0} 条对话 · ${countChars(diary.content)} 字 · 记忆强度 ${normalizeMemoryStrength(diary.memoryStrength, 40)}%`,
                }),
              ),
            ),
            h('p', { class: 'diary-entry-content', text: diary.content }),
          ),
        ),
      )
    : h(
        'div',
        { class: 'empty-state compact' },
        h('span', { class: 'empty-icon' }, icon('brain')),
        h('h3', { class: 'empty-title', text: '还没有日记' }),
        h('p', {
          class: 'empty-body',
          text: '当这一章聊到合适的位置，点击「结束本章」让 AI 把对话折叠成 100–200 字记忆。',
        }),
      );

  return openModal({
    title: '记忆日记',
    eyebrow: `${archive.name} · 共 ${diaries.length} 篇`,
    subtitle: '之后发送的提示词只读取日记与最近未压缩对话，不读取完整历史。',
    size: 'lg',
    body,
    actions: [
      {
        label: '导出全部日记',
        variant: 'ghost',
        icon: 'download',
        disabled: !diaries.length,
        onClick: () => {
          downloadJson(
            `${sanitizeFileName(archive.name)}-diaries.json`,
            {
              kind: 'warm-isle.diaries',
              archive: archive.name,
              exportedAt: new Date().toISOString(),
              diaries,
            },
          );
          app.store.info('diary.exported', `导出了「${archive.name}」的 ${diaries.length} 篇日记。`, {
            archiveId,
          });
          toastSuccess('日记已导出。');
        },
      },
      { label: '关闭', variant: 'primary' },
    ],
  });
}

export async function openDiaryGenerator(
  app,
  archiveId,
  { onSaved, memoryStrength: requestedStrength = null } = {},
) {
  const archive = app.store.getArchive(archiveId);
  if (!archive) return null;
  const segment = archive.messages.slice(archive.summarizedUntil || 0);
  if (segment.length < 2) {
    toast('再多聊几句，才有值得收进日记的内容。', { type: 'info' });
    return null;
  }

  const { settings, apiKey } = currentSettings(app);
  const persona = app.store.getPersona(archive.personaId);
  const initialStrength = normalizeMemoryStrength(
    requestedStrength ?? settings.diaryMemoryStrength,
    40,
  );
  const strengthMeta = getMemoryStrengthMeta(initialStrength);
  const fullTranscript = buildFullDiaryTranscript(archive, {
    start: archive.summarizedUntil || 0,
  });
  const prompt =
    initialStrength > 0 && initialStrength < 100
      ? buildDiaryPrompt({
          archive,
          persona,
          memoryStrength: initialStrength,
        })
      : null;
  const promptText = prompt ? prompt.messages.map((message) => message.content).join('\n') : '';

  let closedByUser = false;
  let completed = false;
  const abortController = new AbortController();
  const progressCopy = h('p', {
    class: 'progress-copy',
    text:
      initialStrength <= 0
        ? '正在把这一章设为不记忆…'
        : initialStrength >= 100
          ? '正在保存这一章的完整对话…'
          : `正在把最近的 ${segment.length} 条对话整理成 ${strengthMeta.label}…`,
  });
  const progressBody = h(
    'div',
    { class: 'progress-state' },
    h('span', { class: 'spinner large' }),
    progressCopy,
    h('p', {
      class: 'muted small',
      text:
        initialStrength <= 0
          ? '保存后本章不会留下任何日记记忆。'
          : initialStrength >= 100
            ? '100% 会保留本章全部对话原文，不再压缩。'
            : `目标长度：${strengthMeta.target}；完成后可以先修改再保存。`,
    }),
  );

  const progressModal = openModal({
    title: '把这一章收进日记',
    eyebrow: archive.name,
    size: 'sm',
    body: progressBody,
    actions: [{ label: '取消', variant: 'ghost' }],
    onClose: () => {
      closedByUser = true;
      if (!completed) abortController.abort();
    },
  });

  let generatedText = '';
  let resultModel = 'demo';
  let usage = null;
  let cached = false;
  try {
    if (initialStrength <= 0) {
      generatedText = '';
      resultModel = 'none';
    } else if (initialStrength >= 100) {
      generatedText = fullTranscript;
      resultModel = 'full-transcript';
    } else if (settings.demoMode) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      generatedText = demoDiary({ persona, archive });
      resultModel = 'demo';
    } else {
      const result = await completeChat({
        settings,
        messages: prompt.messages,
        apiKey,
        signal: abortController.signal,
        useCache: true,
        cacheScope: 'diary',
      });
      generatedText = extractDiaryText(result.text);
      resultModel = result.model;
      cached = Boolean(result.cached);
      usage = recordResult(
        app,
        archiveId,
        settings.provider,
        result.usage,
        promptText,
        result.text,
        { record: !cached },
      );
      app.markAIStatus?.('online');
      app.store.info('diary.generated', 'AI 生成了一篇章节日记草稿。', {
        archiveId,
        detail: {
          model: resultModel,
          tokens: usage?.totalTokens || 0,
          cached,
          messages: segment.length,
          memoryStrength: initialStrength,
        },
      });
    }
  } catch (error) {
    if (!closedByUser && error?.code !== 'ABORTED') {
      progressModal.close();
      showAIError(app, error, archiveId, 'diary.generate');
    }
    return null;
  } finally {
    completed = true;
  }

  if (closedByUser) return null;
  progressModal.close();
  return openDiaryEditor(app, {
    archive,
    generatedText,
    resultModel,
    usage,
    cached,
    segmentCount: segment.length,
    onSaved,
    memoryStrength: initialStrength,
    fullTranscript,
    onRegenerate: (nextStrength) =>
      openDiaryGenerator(app, archiveId, {
        onSaved,
        memoryStrength: nextStrength,
      }),
  });
}

function openDiaryEditor(
  app,
  {
    archive,
    generatedText,
    resultModel,
    usage,
    cached,
    segmentCount,
    onSaved,
    memoryStrength: initialStrength,
    fullTranscript,
    onRegenerate,
  },
) {
  const editor = textarea({
    id: 'diary-content',
    value: generatedText,
    rows: 8,
    maxLength: FULL_MEMORY_MAX_CHARS,
    autofocus: true,
  });
  const counter = h('span', { class: 'char-counter' });
  const rangeHint = h('p', { class: 'field-hint' });
  let currentStrength = normalizeMemoryStrength(initialStrength, 40);
  let modal = null;

  const strengthValue = h('strong', {
    class: 'memory-strength-value',
    text: `${currentStrength}%`,
  });
  const strengthLabel = h('span', { class: 'memory-strength-label' });
  const strengthTarget = h('span', { class: 'memory-strength-target' });
  const strengthRange = h('input', {
    class: 'memory-strength-range',
    type: 'range',
    min: '0',
    max: '100',
    step: '1',
    value: String(currentStrength),
    'aria-label': '日记记忆强度',
  });
  const memoryRows = new Map();
  const memoryTable = h(
    'div',
    { class: 'memory-strength-table', role: 'table', 'aria-label': '记忆强度对照表' },
    h(
      'div',
      { class: 'memory-strength-table-head', role: 'row' },
      h('span', { role: 'columnheader', text: '强度' }),
      h('span', { role: 'columnheader', text: '记忆程度' }),
      h('span', { role: 'columnheader', text: '大约记住' }),
    ),
    ...MEMORY_STRENGTH_LEVELS.map((level) => {
      const row = h(
        'div',
        { class: 'memory-strength-row', role: 'row' },
        h('strong', {
          role: 'cell',
          text: level.min === level.max ? `${level.min}%` : `${level.min}–${level.max}%`,
        }),
        h('span', { role: 'cell', text: level.label }),
        h('small', { role: 'cell', text: level.target }),
        h('p', { role: 'cell', text: level.description }),
      );
      memoryRows.set(level, row);
      return row;
    }),
  );
  const memoryPanel = h(
    'section',
    { class: 'diary-memory-panel' },
    h(
      'div',
      { class: 'diary-memory-head' },
      h(
        'div',
        {},
        h('span', { class: 'field-label', text: '记忆强度' }),
        h('p', {
          class: 'field-hint',
          text: '数值越高，日记越长、细节越多；0% 不记忆，100% 保存完整对话。',
        }),
      ),
      strengthValue,
    ),
    h('div', { class: 'memory-strength-readout' }, strengthLabel, strengthTarget),
    strengthRange,
    memoryTable,
  );

  const updateStrengthUi = () => {
    const meta = getMemoryStrengthMeta(currentStrength);
    const target = meta.target;
    strengthRange.value = String(currentStrength);
    strengthValue.textContent = `${currentStrength}%`;
    strengthLabel.textContent = meta.label;
    strengthTarget.textContent = target;
    for (const [level, row] of memoryRows) {
      const active = currentStrength >= level.min && currentStrength <= level.max;
      row.classList.toggle('is-active', active);
      if (active) {
        const top = row.offsetTop - memoryTable.offsetTop;
        const bottom = top + row.offsetHeight;
        if (top < memoryTable.scrollTop || bottom > memoryTable.scrollTop + memoryTable.clientHeight) {
          memoryTable.scrollTop = Math.max(0, top - 6);
        }
      }
    }
    editor.disabled = currentStrength <= 0;
    editor.placeholder =
      currentStrength <= 0
        ? '0%：本章不保存日记，也不会被后续对话记住。'
        : '';
    if (currentStrength >= 100 && editor.value.trim() !== fullTranscript) {
      editor.value = fullTranscript;
    }
    updateCount();
  };

  const updateCount = () => {
    const count = countChars(editor.value.replace(/\s+/g, ''));
    counter.textContent = `${count} 字`;
    if (currentStrength <= 0) {
      rangeHint.textContent = '0%：不保存日记，本章不会进入后续记忆。';
      counter.classList.remove('is-over');
      return;
    }
    const meta = getMemoryStrengthMeta(currentStrength);
    const targetMax = Number(meta.target.match(/(\d+)\s*字$/)?.[1] || 0);
    rangeHint.textContent = `当前 ${currentStrength}% · ${meta.label}；目标 ${meta.target}，当前 ${count} 字。`;
    counter.classList.toggle('is-over', Boolean(targetMax && count > targetMax * 1.25));
  };
  editor.addEventListener('input', updateCount);
  strengthRange.addEventListener('input', () => {
    currentStrength = normalizeMemoryStrength(strengthRange.value, 40);
    updateStrengthUi();
    updateUsageNote();
  });

  const usageNote = h('span', { class: 'muted small' });
  const updateUsageNote = () => {
    usageNote.textContent =
      currentStrength <= 0
        ? '不生成日记'
        : currentStrength >= 100
          ? '完整对话，不调用 AI 压缩'
          : usage?.totalTokens
            ? `本次生成 ${usage.totalTokens} tokens${usage.estimated ? '（估算）' : ''}${cached ? ' · 本地缓存' : ''}`
            : '演示模式，不消耗 token';
  };

  updateStrengthUi();
  updateCount();
  updateUsageNote();

  const regenerateButton =
    typeof onRegenerate === 'function'
      ? h(
          'button',
          {
            class: 'btn btn-soft btn-sm',
            type: 'button',
            onclick: async () => {
              const ok = await confirmDialog({
                title: '按当前强度重新生成？',
                message: '当前草稿会被新生成的内容替换。记忆强度相同则不会改变。',
                confirmText: '重新生成',
              });
              if (!ok) return;
              modal?.close();
              onRegenerate(currentStrength);
            },
          },
          icon('refresh'),
          h('span', { text: '按当前强度重新生成' }),
        )
      : null;

  const body = h(
    'div',
    { class: 'diary-editor' },
    memoryPanel,
    h(
      'div',
      { class: 'diary-editor-meta' },
      h('span', { class: 'tag tag-warm', text: `${segmentCount} 条对话` }),
      usageNote,
      regenerateButton,
    ),
    h(
      'label',
      { class: 'field', for: 'diary-content' },
      h('span', { class: 'field-label', text: '日记正文' }),
      editor,
      h('div', { class: 'field-counter-row' }, rangeHint, counter),
    ),
    h('p', {
      class: 'muted small',
      text:
        currentStrength <= 0
          ? '保存后会直接跳过这一章的记忆，不会创建日记。'
          : currentStrength >= 100
            ? '100% 保存完整对话，可能显著增加后续提示词长度。'
            : '保存后，这段对话会从下一轮提示词中被这篇日记替代。',
    }),
  );

  modal = openModal({
    title: '这一章，留下了什么',
    eyebrow: archive.name,
    subtitle: '可以修改草稿，并用记忆强度决定保留多少。',
    size: 'lg',
    body,
    actions: [
      { label: '放弃', variant: 'ghost' },
      {
        label: '保存本章',
        variant: 'primary',
        onClick: () => {
          const now = new Date().toISOString();
          if (currentStrength <= 0) {
            app.store.update(
              (state) => {
                const target = state.archives.find((item) => item.id === archive.id);
                if (!target) return;
                target.summarizedUntil = target.messages.length;
                target.updatedAt = now;
                state.settings.diaryMemoryStrength = 0;
              },
              { reason: 'diary-skipped', archiveId: archive.id },
            );
            app.store.info('diary.skipped', '本章设为不记忆，没有创建日记。', {
              archiveId: archive.id,
              detail: { memoryStrength: 0, messageCount: segmentCount },
            });
            toast('本章不会留下记忆。', { type: 'info' });
            onSaved?.(null);
            return true;
          }
          const content = editor.value.trim();
          const charCount = countChars(content.replace(/\s+/g, ''));
          if (charCount < 20) {
            toastError('日记太短了，再写一点吧。');
            editor.focus();
            return false;
          }
          const diary = {
            id: createId('diary'),
            content,
            memoryStrength: currentStrength,
            createdAt: now,
            messageCount: archive.messages.length - (archive.summarizedUntil || 0),
            rangeStart: archive.summarizedUntil || 0,
            rangeEnd: archive.messages.length,
            model: resultModel || '',
            usage: usage || null,
          };
          app.store.update(
            (state) => {
              const target = state.archives.find((item) => item.id === archive.id);
              if (!target) return;
              target.diaries.push(diary);
              target.summarizedUntil = target.messages.length;
              target.updatedAt = now;
              state.settings.diaryMemoryStrength = currentStrength;
            },
            { reason: 'diary-saved', archiveId: archive.id },
          );
          app.store.info(
            'diary.saved',
            `保存了章节日记（记忆强度 ${currentStrength}%），对话记忆为 ${charCount} 字。`,
            {
              archiveId: archive.id,
              detail: {
                diaryId: diary.id,
                messageCount: diary.messageCount,
                memoryStrength: currentStrength,
              },
            },
          );
          toastSuccess(`日记已保存（记忆强度 ${currentStrength}%）。`);
          onSaved?.(diary);
          return true;
        },
      },
    ],
  });
  return modal;
}

/* ------------------------------------------------------------------ */
/* 导出                                                                */
/* ------------------------------------------------------------------ */

export function exportArchivePersona(app, archiveId, { quiet = false } = {}) {
  const archive = app.store.getArchive(archiveId);
  const persona = archive ? app.store.getPersona(archive.personaId) : null;
  if (!persona) {
    toastError('找不到这个存档对应的人格。');
    return;
  }
  downloadJson(personaExportFilename(persona), exportPersonaPayload(persona));
  if (!quiet) {
    app.store.info('persona.exported', `导出了人格「${persona.name}」。`, { archiveId });
    toastSuccess(`「${persona.name}」的人格 JSON 已导出。`);
  }
}

export function exportArchiveBundle(app, archiveId) {
  const archive = app.store.getArchive(archiveId);
  if (!archive) return;
  const persona = app.store.getPersona(archive.personaId);
  const worldbook = app.store.getWorldbook(archive.worldbookId);
  const bundle = {
    schemaVersion: 1,
    kind: 'warm-isle.archive',
    exportedAt: new Date().toISOString(),
    archive,
    persona: persona ? exportPersonaPayload(persona) : null,
    worldbook,
  };
  downloadJson(`${sanitizeFileName(archive.name)}.archive.json`, bundle);
  app.store.info('archive.exported', `导出了存档「${archive.name}」。`, { archiveId });
  toastSuccess('存档已导出。');
}

export async function deleteArchiveWithConfirm(app, archiveId, { onDeleted } = {}) {
  const archive = app.store.getArchive(archiveId);
  if (!archive) return false;
  const ok = await confirmDialog({
    title: '删除这个存档？',
    message: `「${archive.name}」的对话、状态和日记都会从这台设备删除，且无法撤销。人格和世界书本身会保留。`,
    confirmText: '删除存档',
    danger: true,
  });
  if (!ok) return false;
  app.store.removeArchive(archiveId);
  app.store.info('archive.deleted', `删除了存档「${archive.name}」。`);
  toastSuccess('存档已删除。');
  onDeleted?.(archive);
  return true;
}


