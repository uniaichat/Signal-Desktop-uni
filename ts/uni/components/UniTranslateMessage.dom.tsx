import React, { JSX, useEffect, useState } from 'react';
import { uniStore } from '../uni.store';
import { uniUtils } from '../uni.web.utls';
import { AxoSymbol } from '../../axo/AxoSymbol.dom';
import { tw } from '../../axo/tw.dom';
import { assert } from '../../axo/_internal/assert.std';
export type UniTranslateMessageProps = {
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
    `max-w-[234px] leading-[24px] whitespace-normal break-words [direction:auto] [overflow-wrap:anywhere] l`
  ),
  refresh: tw('mx-1 cursor-pointer'),
};
export function UniTranslateMessage({
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
    </div>
  );
}
