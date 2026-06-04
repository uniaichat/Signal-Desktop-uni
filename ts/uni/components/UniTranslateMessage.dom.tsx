
import React, { useEffect, useState } from 'react';
import { uniStore } from '../uni.store';
import { uniUtils } from '../uni.web.utls';
import { AxoSymbol } from '../../axo/AxoSymbol.dom';
import { tw } from '../../axo/tw.dom';
import { assert } from '../../axo/_internal/assert.std';
export type UniTranslateMessageProps = {
    text: string;
    direction: String;

}
const styleName = {
    box: tw(`py-1 text-[var(--font-r-color)] border-t border-dashed border-t-[var(--font-r-color)]`),
    boxSend: tw(`py-1 text-[var(--font-s-color)] border-t border-dashed border-t-[var(--font-s-color)]`),
    resultText: tw(`[font-size:var(--font-size)]`),
    button: tw(`rounded-sm px-1 font-medium [font-size:12px] bg-[var(--font-r-color)] text-[var(--inver-color)] cursor-pointer mx-0.5 `),
    buttonSend: tw(`rounded-sm px-1 font-medium [font-size:12px] bg-[var(--font-s-color)] text-[var(--inver-s-color)] cursor-pointer mx-0.5 `),
    refresh: tw('cursor-pointer mx-1')
}
export function UniTranslateMessage({ direction, text }: UniTranslateMessageProps): Element {
    const [storeGlobalCon, setStoreGlobalCon] = useState(uniStore.getState().translateConfigGlobal)
    const [curChat, setCurChat] = useState(uniStore.getState().curChat)
    const [tranLoading, setTranLoading] = useState(false)
    const [tranResultStatus, setResultStatus] = useState('success');
    const [resultText, setResultText] = useState('')
    const [isManualed, setIsManualed] = useState(false)
    const getTranslateData = async (forceRefresh?:boolean) => {
        if (tranLoading) return
        setResultText('翻译中...')
        setTranLoading(true)
        const result = await uniUtils.messageTranslate({to:storeGlobalCon.formLang,text,forceRefresh})
        console.log(result)
        setTranLoading(false)
        if (result.data) {
            setResultStatus('success')
            setResultText(result.data)
        } else if(result.code === 508) {
            setResultStatus('success')
            setResultText(text)

        }else{
            setResultStatus('error')
            setResultText(result.msg)
        }

    }
    const handleAi = async () => {

    }
    const handleManualTranslate = ()=>{
        setIsManualed(true)
        getTranslateData()
    }
    const handleRefresh = async () => {
        getTranslateData(true)
    }
    useEffect(() => {
        if((direction === 'outgoing' && curChat.sendTranslate) || (direction === 'incoming' && curChat.receiveTranslate)){
            getTranslateData();
        }
        uniStore.subscribe(() => {
            setStoreGlobalCon(uniStore.getState().translateConfigGlobal)
            setCurChat(uniStore.getState().curChat)
        })
    }, [text,curChat.sendTranslate,curChat.receiveTranslate])
    const renderContent = ()=>{
        if((direction === 'outgoing' && !curChat.sendTranslate) || (direction === 'incoming' && !curChat.receiveTranslate) && !isManualed){
            return <span onClick={handleManualTranslate} className={assert(tw(styleName.button))}>点击翻译</span>
        }
        if(tranResultStatus === 'success'){
            return <>
                <span className={styleName.resultText}>{resultText}</span>
                <span onClick={handleRefresh} className={assert(tw(styleName.refresh))}><AxoSymbol.InlineGlyph symbol='refresh' label={null} /></span>
                {/* <span onClick={handleAi} className={assert(tw(styleName.button))}>AI回复</span> */}
            </>
        }
        return <>
            <span className={styleName.resultText}>{resultText}</span>
            <span onClick={handleRefresh} className={assert(tw( direction === 'outgoing' ? styleName.buttonSend : styleName.button))}>点击重试</span>
        </>
    }
    return (<div className={direction === 'outgoing' ? styleName.boxSend : styleName.box} style={{
        "--font-r-color": storeGlobalCon.fontReceiveColor,
        "--font-s-color": storeGlobalCon.fontSendColor,
        "--font-size": storeGlobalCon.fontSize + 'px',
        "--inver-color": uniUtils.invertHex(storeGlobalCon.fontReceiveColor),
        "--inver-s-color": uniUtils.invertHex(storeGlobalCon.fontSendColor)
    } as React.CSSProperties}>
        {renderContent()}
    </div>)
}