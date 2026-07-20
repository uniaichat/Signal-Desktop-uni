import React, { JSX, useEffect, useState } from 'react';
import { uniStore } from '../uni.store';
import { uniHttpApi, uniUtils } from '../uni.web.utls';
import { AxoSymbol } from '../../axo/AxoSymbol.dom';
import { tw } from '../../axo/tw.dom';
import { assert } from '../../axo/_internal/assert.std';
import { UniToast } from './UniToast';
export type UniTranslateMessageProps = {
  conversationId?: string;
  messageId?: string;
  timestamp?: number;
  text?: string;
  url?: string;
  audioContentType?: string;
  audioFileName?: string;
  direction: String;
};
const styleName = {
  box: tw(
    `border-t border-dashed border-t-[var(--font-r-color)] py-1 text-[var(--font-r-color)]`
  ),
  boxSend: tw(
    `border-t border-dashed border-t-[var(--font-s-color)] py-1 text-[var(--font-s-color)]`
  ),
  resultText: tw(`[font-size:var(--font-size)]`),
  button: tw(
    `mx-0.5 cursor-pointer rounded-sm bg-[var(--font-r-color)] px-1 [font-size:12px] font-medium text-[var(--inver-color)]`
  ),
  buttonSend: tw(
    `mx-0.5 cursor-pointer rounded-sm bg-[var(--font-s-color)] px-1 [font-size:12px] font-medium text-[var(--inver-s-color)]`
  ),
  audioBox: tw(
    `l max-w-[234px] leading-[24px] [overflow-wrap:anywhere] break-words whitespace-normal [direction:auto]`
  ),
  refresh: tw('mx-1 cursor-pointer'),
  aiWrap: tw('relative mx-1 inline-block'),
  aiButton: tw(
    'cursor-pointer rounded-sm bg-[var(--font-r-color)] px-1.5 py-0.5 text-[12px] font-medium text-[var(--inver-color)] disabled:cursor-wait disabled:opacity-60'
  ),
  aiPanel: tw(
    'shadow-lg absolute bottom-full left-0 z-[100] mb-1 w-[250px] rounded-md border border-[var(--color-gray-25)] bg-[var(--color-background-primary)] p-2 text-[12px] text-[var(--color-text-primary)]'
  ),
  aiRow: tw('mb-2 flex items-center justify-between gap-2'),
  aiSelect: tw(
    'min-w-0 flex-1 rounded border border-[var(--color-gray-25)] bg-[var(--color-background-primary)] px-1 py-0.5 text-[12px] text-[var(--color-text-primary)]'
  ),
  aiResults: tw(
    'shadow-lg absolute bottom-full left-0 z-[101] mb-1 w-[360px] max-w-[70vw] rounded-md border border-[var(--color-gray-25)] bg-[var(--color-background-primary)] p-2 text-[var(--color-text-primary)]'
  ),
  aiResult: tw(
    'block w-full cursor-pointer rounded px-2 py-1 text-left hover:bg-[var(--color-background-secondary)]'
  ),
};

type AiHistoryEntry = Readonly<{
  conversationId: string;
  direction: String;
  messageId: string;
  text: string;
  timestamp: number;
}>;

const aiHistory = new Map<string, AiHistoryEntry>();
const AI_MODEL_KEY = 'uni_ai_m';
const AI_SEX_KEY = 'uni_ai_sex';
const AI_HISTORY_KEY = 'aiHistoryNumCache';
const AI_MULTIPLE_KEY = 'aiMultipleResultsOffOnCache';

function getAiHistory(
  conversationId: string,
  timestamp: number,
  count: number
): Array<{ user?: string; assistant?: string }> {
  return [...aiHistory.values()]
    .filter(
      item =>
        item.conversationId === conversationId && item.timestamp <= timestamp
    )
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(-count)
    .map(item =>
      item.direction === 'outgoing'
        ? { assistant: item.text }
        : { user: item.text }
    );
}
export function UniTranslateMessage({
  conversationId,
  messageId,
  timestamp,
  direction,
  text,
  url,
  audioContentType,
  audioFileName,
}: UniTranslateMessageProps): JSX.Element {
  const [storeGlobalCon, setStoreGlobalCon] = useState(
    uniStore.getState().translateConfigGlobal
  );
  const [curChat, setCurChat] = useState(uniStore.getState().curChat);
  const [tranLoading, setTranLoading] = useState(false);
  const [tranResultStatus, setResultStatus] = useState('success');
  const [resultText, setResultText] = useState('');
  const [isManualed, setIsManualed] = useState(false);
  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResults, setAiResults] = useState<Array<string>>([]);
  const [aiModel, setAiModel] = useState(
    () => localStorage.getItem(AI_MODEL_KEY) || 'gpt-4.1-mini'
  );
  const [aiSex, setAiSex] = useState(
    () => localStorage.getItem(AI_SEX_KEY) || '女'
  );
  const [aiHistoryCount, setAiHistoryCount] = useState(() => {
    const cached = Number(localStorage.getItem(AI_HISTORY_KEY) || 3);
    return Number.isFinite(cached) ? Math.max(1, cached) : 3;
  });
  const [aiMultiple, setAiMultiple] = useState(
    () => localStorage.getItem(AI_MULTIPLE_KEY) !== '0'
  );

  useEffect(() => {
    if (!text || !conversationId || !messageId || timestamp == null) {
      return undefined;
    }
    aiHistory.set(messageId, {
      conversationId,
      direction,
      messageId,
      text,
      timestamp,
    });
    return () => {
      aiHistory.delete(messageId);
    };
  }, [conversationId, direction, messageId, text, timestamp]);

  const applyAiReply = (reply: string) => {
    if (!conversationId) {
      return;
    }
    window.dispatchEvent(
      new CustomEvent('uni-ai-reply', {
        detail: { conversationId, text: reply },
      })
    );
    setAiResults([]);
    setAiMenuOpen(false);
  };

  const handleAiReply = async (tone: string) => {
    if (
      aiLoading ||
      !text ||
      !conversationId ||
      !messageId ||
      timestamp == null
    ) {
      return;
    }
    setAiLoading(true);
    setAiMenuOpen(false);
    try {
      const history = getAiHistory(conversationId, timestamp, aiHistoryCount);
      const multiplePrompt = aiMultiple
        ? '给出多个结果供我选择，每个结果用“●”分隔。'
        : '只给出一条回复，不要解释。';
      const prompt = `你是一个${aiSex}性聊天助手。请结合我给出的聊天记录，用中文回复最后一条消息。需要使用${tone}的口气。${multiplePrompt}`;
      const response = await uniHttpApi.aiReply({
        messages: [
          { content: prompt, role: 'system' },
          { content: JSON.stringify(history), role: 'user' },
        ],
        model: aiModel,
      });
      const result =
        typeof response?.data === 'string'
          ? response.data
          : typeof response?.result === 'string'
            ? response.result
            : '';
      if (!result) {
        throw new Error(response?.msg || 'AI 回复生成失败');
      }
      if (aiMultiple) {
        const results = result
          .split(/[●•]/u)
          .map((item: string) => item.trim())
          .filter(Boolean);
        setAiResults(results.length > 0 ? results : [result]);
      } else {
        applyAiReply(result.trim());
      }
    } catch (error) {
      UniToast.error(
        error instanceof Error ? error.message : 'AI 回复生成失败'
      );
    } finally {
      setAiLoading(false);
    }
  };
  const getTranslateData = async (forceRefresh?: boolean) => {
    if (tranLoading) return;
    setResultText('翻译中...');
    setTranLoading(true);
    const result = await uniUtils.messageTranslate({
      to: storeGlobalCon.formLang,
      text: text ?? '',
      forceRefresh,
    });
    console.log(result);
    setTranLoading(false);
    if (result.data) {
      setResultStatus('success');
      setResultText(result.data);
    } else if (result.code === 508) {
      setResultStatus('success');
      setResultText(text ?? '');
    } else {
      setResultStatus('error');
      setResultText(result.msg ?? '翻译失败');
    }
  };
  const getAudioTranslateData = async () => {
    if (tranLoading || !url) return;
    setResultText('文件获取中...');
    setTranLoading(true);
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const contentType =
        audioContentType || blob.type || 'application/octet-stream';
      const extensionByContentType: Readonly<Record<string, string>> = {
        'audio/aac': 'aac',
        'audio/m4a': 'm4a',
        'audio/mp4': 'm4a',
        'audio/mp3': 'mp3',
        'audio/mpeg': 'mp3',
        'audio/ogg': 'ogg',
        'audio/wav': 'wav',
        'audio/webm': 'webm',
      };
      const extension =
        extensionByContentType[contentType.toLowerCase()] ?? 'audio';
      setResultText('翻译中...');
      const channel = storeGlobalCon.curChannel;
      const result = await uniUtils.messageAudioTranslate({
        fileName: audioFileName || `${Date.now()}.${extension}`,
        type: contentType,
        buffer: new Uint8Array(await blob.arrayBuffer()),
        languageCode: uniUtils.getLangCodeByChannel(
          storeGlobalCon.formLang,
          channel
        ),
        channel,
      });
      if (result.translation) {
        setResultStatus('success');
        setResultText(result.translation);
      } else {
        setResultStatus('error');
        setResultText(result.message ?? result.msg ?? '翻译失败');
      }
    } catch (error) {
      setResultStatus('error');
      setResultText(error instanceof Error ? error.message : '翻译失败');
    } finally {
      setTranLoading(false);
    }
  };
  const handleManualTranslate = () => {
    setIsManualed(true);
    if (url) {
      void getAudioTranslateData();
    } else {
      void getTranslateData();
    }
  };
  const handleRefresh = async () => {
    if (url) {
      await getAudioTranslateData();
    } else {
      await getTranslateData(true);
    }
  };
  useEffect(() => {
    if (
      (direction === 'outgoing' && curChat.sendTranslate) ||
      (direction === 'incoming' && curChat.receiveTranslate)
    ) {
      if (url) {
        void getAudioTranslateData();
      } else if (text) {
        void getTranslateData();
      }
    }
    return uniStore.subscribe(() => {
      setStoreGlobalCon(uniStore.getState().translateConfigGlobal);
      setCurChat(uniStore.getState().curChat);
    });
  }, [text, url, curChat.sendTranslate, curChat.receiveTranslate]);
  const renderContent = () => {
    if (
      ((direction === 'outgoing' && !curChat.sendTranslate) ||
        (direction === 'incoming' && !curChat.receiveTranslate)) &&
      !isManualed
    ) {
      return (
        <span
          onClick={handleManualTranslate}
          className={assert(tw(styleName.button))}
        >
          点击翻译
        </span>
      );
    }
    if (tranResultStatus === 'success') {
      return (
        <>
          <span className={styleName.resultText}>{resultText}</span>
          <span
            onClick={handleRefresh}
            className={assert(tw(styleName.refresh))}
          >
            <AxoSymbol.InlineGlyph symbol="refresh" label={null} />
          </span>
          {/* <span onClick={handleAi} className={assert(tw(styleName.button))}>AI回复</span> */}
        </>
      );
    }
    return (
      <>
        <span className={styleName.resultText}>{resultText}</span>
        <span
          onClick={handleRefresh}
          className={assert(
            tw(
              direction === 'outgoing' ? styleName.buttonSend : styleName.button
            )
          )}
        >
          点击重试
        </span>
      </>
    );
  };

  const renderAiReply = () => {
    if (
      direction !== 'incoming' ||
      !text ||
      !conversationId ||
      !messageId ||
      timestamp == null
    ) {
      return null;
    }
    const tones = [
      '中性',
      '建议',
      '附和',
      '反驳',
      '反问',
      '共鸣',
      '拉近关系',
      '温柔体贴',
    ];
    return (
      <span className={styleName.aiWrap}>
        <button
          type="button"
          className={styleName.aiButton}
          disabled={aiLoading}
          onClick={() => setAiMenuOpen(open => !open)}
        >
          {aiLoading ? 'AI 回复生成中...' : 'AI 回复'}
        </button>
        {aiMenuOpen && (
          <div className={styleName.aiPanel}>
            <div className={styleName.aiRow}>
              <select
                aria-label="AI 模型"
                className={styleName.aiSelect}
                value={aiModel}
                onChange={event => {
                  setAiModel(event.target.value);
                  localStorage.setItem(AI_MODEL_KEY, event.target.value);
                }}
              >
                <option value="gpt-4.1-mini">gpt4</option>
                <option value="gpt-5-mini">gpt5</option>
              </select>
              <select
                aria-label="助手性别"
                className={styleName.aiSelect}
                value={aiSex}
                onChange={event => {
                  setAiSex(event.target.value);
                  localStorage.setItem(AI_SEX_KEY, event.target.value);
                }}
              >
                <option value="男">男</option>
                <option value="女">女</option>
              </select>
            </div>
            <div className={styleName.aiRow}>
              <label htmlFor={`ai-history-${messageId}`}>历史消息</label>
              <input
                id={`ai-history-${messageId}`}
                className={styleName.aiSelect}
                min={1}
                max={20}
                type="number"
                value={aiHistoryCount}
                onChange={event => {
                  const value = Math.max(
                    1,
                    Math.min(20, Number(event.target.value) || 1)
                  );
                  setAiHistoryCount(value);
                  localStorage.setItem(AI_HISTORY_KEY, String(value));
                }}
              />
              <label>
                <input
                  type="checkbox"
                  checked={aiMultiple}
                  onChange={event => {
                    setAiMultiple(event.target.checked);
                    localStorage.setItem(
                      AI_MULTIPLE_KEY,
                      event.target.checked ? '1' : '0'
                    );
                  }}
                />{' '}
                多结果
              </label>
            </div>
            {tones.map(tone => (
              <button
                type="button"
                key={tone}
                className={styleName.aiResult}
                onClick={() => void handleAiReply(tone)}
              >
                {tone}
              </button>
            ))}
          </div>
        )}
        {aiResults.length > 0 && (
          <div className={styleName.aiResults}>
            <div className={styleName.aiRow}>
              <strong>回复结果</strong>
              <button type="button" onClick={() => setAiResults([])}>
                关闭
              </button>
            </div>
            {aiResults.map((result, index) => (
              <button
                type="button"
                className={styleName.aiResult}
                key={`${index}-${result}`}
                onClick={() => applyAiReply(result)}
              >
                {index + 1}. {result}
              </button>
            ))}
          </div>
        )}
      </span>
    );
  };
  return (
    <div
      className={assert(
        tw(
          direction === 'outgoing' ? styleName.boxSend : styleName.box,
          url ? styleName.audioBox : undefined
        )
      )}
      style={
        {
          '--font-r-color': storeGlobalCon.fontReceiveColor,
          '--font-s-color': storeGlobalCon.fontSendColor,
          '--font-size': storeGlobalCon.fontSize + 'px',
          '--inver-color': uniUtils.invertHex(storeGlobalCon.fontReceiveColor),
          '--inver-s-color': uniUtils.invertHex(storeGlobalCon.fontSendColor),
        } as React.CSSProperties
      }
    >
      {renderContent()}
      {renderAiReply()}
    </div>
  );
}
