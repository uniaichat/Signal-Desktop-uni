
import React, { useEffect, useState } from 'react';
import { spkStore } from '../spk.store';
import { spkHttpApi, spkUtils } from '../spk.web.utls';
import { AxoSymbol } from '../../axo/AxoSymbol.dom';
import { tw } from '../../axo/tw.dom';
import { assert } from '../../axo/_internal/assert.std';
import { SpkToast } from './spkToast';
export type SpkTranslateMessageProps = {
    text?: String;
    url?: String;
    direction: String;

}
const styleName = {
    box: tw(`py-1 text-[var(--font-color)] border-t border-dashed border-t-[var(--font-color)]`),
    resultText: tw(`[font-size:var(--font-size)]`),
    button: tw(`rounded-sm px-1 font-medium [font-size:12px] bg-[var(--font-color)] text-[var(--inver-color)] cursor-pointer mx-0.5 `),
    refresh: tw('cursor-pointer mx-1')
}
export function SpkTranslateMessage({ direction, text, url }: SpkTranslateMessageProps): Element {
    const [storeGlobalCon, setStoreGlobalCon] = useState(spkStore.getState().translateConfigGlobal)
    const [curChat, setCurChat] = useState(spkStore.getState().curChat)
    const [tranLoading, setTranLoading] = useState(false)
    const [tranResultStatus, setResultStatus] = useState('success');
    const [resultText, setResultText] = useState('')
    const [isManualed, setIsManualed] = useState(false)
    const getTranslateData = async (forceRefresh?:boolean) => {
        if (tranLoading) return
        setResultText('翻译中...')
        setTranLoading(true)
        const result = await spkUtils.messageTranslate({to:curChat.formLang, text:text ||'', forceRefresh})
        setTranLoading(false)
        if (result.translation) {
            setResultStatus('success')
            setResultText(result.translation[0])
        } else {
            setResultStatus('error')
            setResultText(result.message)
        }

    }
    const getAudioTranslateData = async (forceRefresh?:boolean) => {
        if (tranLoading) return
        setResultText('文件获取中...')
        const file = await getFile(url)
        setResultText('翻译中...')
        setTranLoading(true)
        const result = await spkUtils.messageAudioTranslate(file)
        setTranLoading(false)
        console.log('result',result)
        if (result.translation) {
            setResultStatus('success')
            setResultText(result.translation[0])
        } else {
            setResultStatus('error')
            setResultText(result.message)
        }

    }
    const handleManualTranslate = ()=>{
        setIsManualed(true)
        getTranslateData()
    }
    const handleRefresh = async () => {
        getTranslateData(true)
    }
    
    async function getFile(fileUrl:any) {
        const res = await fetch(fileUrl);
        const blob = await res.blob();
        
        const arrayBuffer = await blob.arrayBuffer();

        return {
            fileName: `${Date.now()}.ogg`,
            type: 'audio/ogg',
            buffer: arrayBuffer,
        };
    }
    useEffect(() => {
        if((direction === 'outgoing' && curChat.sendTranslate) || (direction === 'incoming' && curChat.receiveTranslate)){
            if(url){
                getAudioTranslateData()
            }else if(text){
                getTranslateData();

            }
        }
        spkStore.subscribe(() => {
            setStoreGlobalCon(spkStore.getState().translateConfigGlobal)
            setCurChat(spkStore.getState().curChat)
        })
    }, [text,url,curChat.sendTranslate,curChat.receiveTranslate])

    const aiItemList = [
        {value:'正式',label:'正式'},
        {value:'专业',label:'专业'},
        {value:'风趣幽默',label:'幽默'},
        {value:'暧昧',label:'暧昧'},
        {value:'高情商',label:'高情商'},
        {value:'高情商',label:'默认'},
    ]
    const [aiCurKey, setAiCurKey] = useState('高情商')
    const [aiBtnText, setAiBtnText] = useState('智能回复')
    const [isAiLoading, setIsAiLoading] = useState(false)
    const handleSelectAi = (value:string)=>{
        setAiCurKey(value);
        handleAi(value)
    }
    const handleAi = async (value?:string) => {
        const tone = value || aiCurKey
        if(isAiLoading){
            return
        }
        const msgContextList = [{user:'',assistant:resultText}]
        setIsAiLoading(true)
        setAiBtnText(`${tone}回复中...`)
        const result = await spkHttpApi.aiReply({
            body : {
                chatHistory : msgContextList,
                tone
            }
        })
        setIsAiLoading(false)
        setAiBtnText(`智能回复`)
        if(result.code != 0){
            SpkToast.error(result.message)
        }else{
            if (result?.data?.message && (window as any).spkSetCompositionText) {
                (window as any).spkSetCompositionText(result?.data?.message);
            }
        }
    }
    const [showAiList, setShowAiList] = useState(false);
    const aiItemListTmp = () => (showAiList && (<ul className="absolute bottom-0 mb-1 pl-2 pr-2 left-0 bg-[var(--font-color)] text-[var(--inver-color)] rounded shadow-md z-10" >
        {aiItemList.map(item => (<li key={item.value} onClick={()=>handleSelectAi(item.value)}>{item.label}</li>))}
    </ul>))
    const renderContent = ()=>{
        if((direction === 'outgoing' && !curChat.sendTranslate) || (direction === 'incoming' && !curChat.receiveTranslate) && !isManualed){
            return <span onClick={handleManualTranslate} className={assert(tw(styleName.button))}>点击翻译</span>
        }
        if(tranResultStatus === 'success'){
            return <>
                <span className={styleName.resultText}>{resultText}</span>
                <span onClick={handleRefresh} className={assert(tw(styleName.refresh))}><AxoSymbol.InlineGlyph symbol='refresh' label={null} /></span>
                <div className={assert(tw(styleName.button) + ' uni-translate-msg-ai relative')} onMouseLeave={() => setShowAiList(false)}>
                    <span onClick={()=>handleAi()}  onMouseEnter={() => setShowAiList(true)}>{aiBtnText}</span>
                    {aiItemListTmp()}
                </div>
            </>
        }
        return <>
            <span className={styleName.resultText}>{resultText}</span>
            <span onClick={handleRefresh} className={assert(tw(styleName.button))}>点击重试</span>
        </>
    }
    return (<div className={styleName.box} style={{
        "--font-color": storeGlobalCon.fontColor,
        "--font-size": storeGlobalCon.fontSize + 'px',
        "--inver-color": spkUtils.invertHex(storeGlobalCon.fontColor)
    } as React.CSSProperties}>
        {renderContent()}
    </div>)
}