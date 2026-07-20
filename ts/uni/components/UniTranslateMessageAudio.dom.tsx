// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { useState, type JSX } from 'react';

import type { DirectionType } from '../../components/conversation/Message.dom.tsx';
import { tw } from '../../axo/tw.dom.tsx';
import { UniTranslateMessage } from './UniTranslateMessage.dom.tsx';

export type UniTranslateMessageAudioProps = Readonly<{
  url: string;
  direction: DirectionType;
  contentType: string;
  fileName?: string;
}>;

export function UniTranslateMessageAudio({
  url,
  direction,
  contentType,
  fileName,
}: UniTranslateMessageAudioProps): JSX.Element | null {
  const [showTranslate, setShowTranslate] = useState(false);

  const uniWindow = window as unknown as {
    uniStore?: {
      getState: () => { userInfo?: { customerId?: string } };
    };
  };
  if (!uniWindow.uniStore?.getState().userInfo?.customerId) {
    return null;
  }

  if (!showTranslate) {
    return (
      <button
        type="button"
        className={tw(
          'mt-1 w-full max-w-[234px] leading-[24px] border-0 border-t border-dashed border-current bg-transparent p-0 pt-1 text-start text-inherit [direction:auto]'
        )}
        onClick={event => {
          event.stopPropagation();
          setShowTranslate(true);
        }}
      >
        翻译
      </button>
    );
  }

  return (
    <UniTranslateMessage
      url={url}
      direction={direction}
      audioContentType={contentType}
      audioFileName={fileName}
    />
  );
}
