import React, { useState } from "react";
import { SpkTranslateMessage } from "./SpkTranslateMessage.dom";

export type SpkTranslateMessageAudioProps = {
    url?: String;
    direction: String;

}
export function SpkTranslateMessageAudio({url,direction}:SpkTranslateMessageAudioProps): JSX.Element {
    const [showTranslate, setShowTranslate] = useState(false)
    return(<>
        {/* {url}--{direction} */}
        {!showTranslate ? <span onClick={()=> setShowTranslate(true)}>翻译</span> : <SpkTranslateMessage url={url} direction={direction}/> }
    </>)
}