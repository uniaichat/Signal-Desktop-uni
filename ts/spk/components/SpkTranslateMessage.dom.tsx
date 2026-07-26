import React, { useEffect, useState, type JSX } from 'react';
import { spkStore } from '../spk.store';
import { spkHttpApi, spkUtils } from '../spk.web.utls';
import { AxoSymbol } from '../../axo/AxoSymbol.dom';
import { tw } from '../../axo/tw.dom';
import { assert } from '../../axo/_internal/assert.std';
import { SpkToast } from './spkToast';
export type SpkTranslateMessageProps = {
  text?: String;
  url?: string;
  audioContentType?: string;
  audioFileName?: string;
  direction: String;
};
const styleName = {
  box: tw(
    `border-t border-dashed border-t-[var(--font-color)] py-1 text-[var(--font-color)]`
  ),
  resultText: tw(`[font-size:var(--font-size)] leading-[24px]`),
  button: tw(
    `mx-0.5 cursor-pointer rounded-sm bg-[var(--font-color)] px-1 [font-size:12px] font-medium text-[var(--inver-color)]`
  ),
  refresh: tw('mx-1 cursor-pointer'),
};
export function SpkTranslateMessage({
  direction,
  text,
  url,
  audioContentType,
  audioFileName,
}: SpkTranslateMessageProps): JSX.Element {
  const [storeGlobalCon, setStoreGlobalCon] = useState(
    spkStore.getState().translateConfigGlobal
  );
  const [curChat, setCurChat] = useState(spkStore.getState().curChat);
  const [tranLoading, setTranLoading] = useState(false);
  const [tranResultStatus, setResultStatus] = useState('success');
  const [resultText, setResultText] = useState('');
  const [isManualed, setIsManualed] = useState(false);
  const getTranslateData = async (forceRefresh?: boolean) => {
    if (tranLoading) return;
    setResultText('翻译中...');
    setTranLoading(true);
    const result = await spkUtils.messageTranslate({
      to: curChat.formLang,
      text: text || '',
      forceRefresh,
    });
    setTranLoading(false);
    if (result.translation) {
      setResultStatus('success');
      setResultText(result.translation[0]);
    } else {
      setResultStatus('error');
      setResultText(result.message);
    }
  };
  const getAudioTranslateData = async () => {
    if (tranLoading) return;
    setResultText('文件获取中...');
    setTranLoading(true);
    try {
      const file = await getFile(url);
      setResultText('翻译中...');
      const result = await spkUtils.messageAudioTranslate(file);
      if (result.translation) {
        setResultStatus('success');
        setResultText(result.translation[0]);
      } else {
        setResultStatus('error');
        setResultText(result.message);
      }
    } catch (error) {
      setResultStatus('error');
      setResultText(error instanceof Error ? error.message : '语音翻译失败');
    } finally {
      setTranLoading(false);
    }
  };
  const handleManualTranslate = () => {
    setIsManualed(true);
    if (url) {
      getAudioTranslateData();
    } else {
      getTranslateData();
    }
  };
  const handleRefresh = async () => {
    if (url) {
      getAudioTranslateData();
    } else {
      getTranslateData(true);
    }
  };

  async function getFile(fileUrl: string | undefined) {
    if (!fileUrl) {
      throw new Error('语音附件不可用');
    }
    const res = await fetch(fileUrl);
    const blob = await res.blob();
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

    return {
      fileName: audioFileName || `${Date.now()}.${extension}`,
      type: contentType,
      buffer: new Uint8Array(await blob.arrayBuffer()),
    };
  }
  useEffect(() => {
    if (
      (direction === 'outgoing' && curChat.sendTranslate) ||
      (direction === 'incoming' && curChat.receiveTranslate)
    ) {
      if (url) {
        getAudioTranslateData();
      } else if (text) {
        getTranslateData();
      }
    }
    spkStore.subscribe(() => {
      setStoreGlobalCon(spkStore.getState().translateConfigGlobal);
      setCurChat(spkStore.getState().curChat);
    });
  }, [text, url, curChat.sendTranslate, curChat.receiveTranslate]);

  const aiItemList = [
    { value: '正式', label: '正式' },
    { value: '专业', label: '专业' },
    { value: '风趣幽默', label: '幽默' },
    { value: '暧昧', label: '暧昧' },
    { value: '高情商', label: '高情商' },
    { value: '高情商', label: '默认' },
  ];
  const [aiCurKey, setAiCurKey] = useState('高情商');
  const [aiBtnText, setAiBtnText] = useState('智能回复');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const handleSelectAi = (value: string) => {
    setAiCurKey(value);
    handleAi(value);
  };
  const handleAi = async (value?: string) => {
    const tone = value || aiCurKey;
    if (isAiLoading) {
      return;
    }
    const msgContextList = [{ user: '', assistant: resultText }];
    setIsAiLoading(true);
    setAiBtnText(`${tone}回复中...`);
    const result = await spkHttpApi.aiReply({
      body: {
        chatHistory: msgContextList,
        tone,
      },
    });
    setIsAiLoading(false);
    setAiBtnText(`智能回复`);
    if (result.code != 0) {
      SpkToast.error(result.message);
    } else {
      if (result?.data?.message && (window as any).spkSetCompositionText) {
        (window as any).spkSetCompositionText(result?.data?.message);
      }
    }
  };
  const [showAiList, setShowAiList] = useState(false);
  const aiItemListTmp = () =>
    showAiList && (
      <ul className="shadow-md absolute bottom-0 left-0 z-10 mb-1 rounded bg-[var(--font-color)] pr-2 pl-2 text-[var(--inver-color)]">
        {aiItemList.map(item => (
          <li key={item.value}  className="leading-[24px]" onClick={() => handleSelectAi(item.value)}>
            {item.label}
          </li>
        ))}
      </ul>
    );
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
          <div
            className={assert(
              tw(styleName.button) + ' uni-translate-msg-ai relative inline'
            )}
            onMouseLeave={() => setShowAiList(false)}
          >
            <span
              onClick={() => handleAi()}
              onMouseEnter={() => setShowAiList(true)}
            >
              {aiBtnText}
            </span>
            {aiItemListTmp()}
          </div>
        </>
      );
    }
    return (
      <>
        <span className={styleName.resultText}>{resultText}</span>
        <span onClick={handleRefresh} className={assert(tw(styleName.button))}>
          点击重试
        </span>
      </>
    );
  };
  return (
    <div
      className={styleName.box}
      style={
        {
          '--font-color': storeGlobalCon.fontColor,
          '--font-size': storeGlobalCon.fontSize + 'px',
          '--inver-color': spkUtils.invertHex(storeGlobalCon.fontColor),
        } as React.CSSProperties
      }
    >
      {renderContent()}
    </div>
  );
}
