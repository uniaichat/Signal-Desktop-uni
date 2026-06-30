
import React, { useState, useEffect } from 'react';
import { Modal } from '../../components/Modal.dom';
import { i18n } from '../../context/i18n.preload';
import { AxoSwitch } from '../../axo/AxoSwitch.dom';
import { Button } from '../../components/Button.dom';
import { tw } from '../../axo/tw.dom';
import { Select } from '../../components/Select.dom';
import { spkStore } from '../spk.store';
const styleName ={
    item:tw('flex items-center my-2'),
    label:tw('mr-[5px]'),
    title:tw('mt-[20px] block'),
    colorItem:tw('w-5 h-5 inile-block mr-2 border border-[#ccc] rounded cursor-pointer'),
    active:tw('border-[#0a07b1]')
}
type SpkTranslateSettingGlobalModalProps = {
    onClose:()=> void;
}
export function SpkTranslateSettingGlobalModal({onClose}:SpkTranslateSettingGlobalModalProps){
    const [storeState, setStoreState] = useState(spkStore.getState());
    const handleChangeSetting = (payload:any)=>{
        spkStore.dispatch({type:'SET_TRANSLATE_CONFIG_GLOBAL',payload})
    }
    useEffect(()=>{
        spkStore.subscribe(()=>{
            setStoreState(spkStore.getState());
        });
    },[]);
    
    const colorSelect = function () {
        const colorArray = ['#FFF','#000','#FF0001','#FF9901','#FFFF02','#98FA1C','#6DDEFF','#403ED6','#ED41FD']
        return (
            <>
            {colorArray.map(item => (
                <em key={item} style={{ background: item }} className={styleName.colorItem} onClick={()=> handleChangeSetting({fontColor:item})}></em>
            ))}
            </>
        )
    }
    return(<Modal modalName='spkTranslateSettingGlobalModal' title="全局翻译设置" modalFooter={
        <>
            <Button onClick={onClose}>{i18n('icu:close')}</Button>
        </>
        } i18n={i18n} noEscapeClose={true} noMouseClose={true}>
        <div>
            <span className={styleName.item}>
                <label className={styleName.label}>翻译服务器</label>
                <Select value={storeState.translateConfigGlobal.curServer} moduleClassName='spk-min-select' options={storeState.serverList} onChange={(curServer)=> handleChangeSetting({curServer})}/>
            </span>
            <span className={styleName.item}>
                <label className={styleName.label}>字体颜色</label>
                {colorSelect()}
                {/* <AxoSwitch.Root checked={true} onCheckedChange={()=>{}}/> */}
            </span>
            <span className={styleName.item}>
                <label className={styleName.label}>字体大小</label>
                <Select value={storeState.translateConfigGlobal.fontSize} moduleClassName='spk-min-select' options={storeState.fontSizeList} onChange={(fontSize)=> handleChangeSetting({fontSize})}/>
            </span>
            {/* <span className={styleName.item}>
                <label className={styleName.label}>禁发中文</label>
                <AxoSwitch.Root checked={storeState.translateConfigGlobal.notSendChinese} onCheckedChange={(notSendChinese)=>{handleChangeSetting({notSendChinese})}}/>
            </span> */}
            <b className={styleName.title}>应用默认值，每个聊天可独立设置</b>
            <span className={styleName.item}>
                <label className={styleName.label}>接收翻译</label>
                <AxoSwitch.Root checked={storeState.translateConfigGlobal.receiveTranslate} onCheckedChange={(receiveTranslate)=>{handleChangeSetting({receiveTranslate})}}/>
            </span>
            <span className={styleName.item}>
                <label className={styleName.label}>发送翻译</label>
                <AxoSwitch.Root checked={storeState.translateConfigGlobal.sendTranslate} onCheckedChange={(sendTranslate)=>{handleChangeSetting({sendTranslate})}}/>
            </span>
            <span className={styleName.item}>
                <label className={styleName.label}>自己的语言</label>
                {/* <AxoSwitch.Root checked={storeState.translateConfigGlobal.sendTranslate} onCheckedChange={(sendTranslate)=>{handleChangeSetting({sendTranslate})}}/> */}
                <Select value={storeState.translateConfigGlobal.formLang} moduleClassName="spk-min-select" options={storeState.langList} onChange={(formLang)=>handleChangeSetting({formLang})}></Select>   
            </span>
            <span className={styleName.item}>
                <label className={styleName.label}>对方的语言</label>
                <Select value={storeState.translateConfigGlobal.toLang} moduleClassName="spk-min-select" options={storeState.langList} onChange={(toLang)=>handleChangeSetting({toLang})}></Select>   
            </span>
        </div>
    </Modal>)
}