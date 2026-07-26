import { useState, type JSX } from 'react';

import { SpkTranslateMessage } from './SpkTranslateMessage.dom';

export type SpkTranslateMessageAudioProps = {
  url: string;
  direction: String;
  contentType: string;
  fileName?: string;
};

export function SpkTranslateMessageAudio({
  url,
  direction,
  contentType,
  fileName,
}: SpkTranslateMessageAudioProps): JSX.Element {
  const [showTranslate, setShowTranslate] = useState(false);

  return (
    <>
      {!showTranslate ? (
        <span onClick={() => setShowTranslate(true)} className='leading-[24px]'>翻译</span>
      ) : (
        <SpkTranslateMessage
          url={url}
          direction={direction}
          audioContentType={contentType}
          audioFileName={fileName}
        />
      )}
    </>
  );
}
