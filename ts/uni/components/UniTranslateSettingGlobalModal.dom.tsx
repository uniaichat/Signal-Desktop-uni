
import React, { useState, useEffect } from 'react';
import { Modal } from '../../components/Modal.dom';
import { i18n } from '../../context/i18n.preload';
import { AxoSwitch } from '../../axo/AxoSwitch.dom';
import { Button } from '../../components/Button.dom';
import { tw } from '../../axo/tw.dom';
import { Select } from '../../components/Select.dom';
import { UniColorPick } from './UniColorPick.dom';
import { uniStore } from '../uni.store';
const styleName ={
    item:tw('flex items-center my-3'),
    label:tw('mr-[5px] w-[90px]' ),
    title:tw('mt-[20px] block')
}
type UniTranslateSettingGlobalModalProps = {
    onClose:()=> void;
}
export function UniTranslateSettingGlobalModal({onClose}:UniTranslateSettingGlobalModalProps){
    const [storeState, setStoreState] = useState(uniStore.getState());
    const handleChangeSetting = (payload:any)=>{
        uniStore.dispatch({type:'SET_TRANSLATE_CONFIG_GLOBAL',payload})
    }
    useEffect(()=>{
        uniStore.subscribe(()=>{
            setStoreState(uniStore.getState());
        });
    },[]);
    return(<Modal modalName='uniTranslateSettingGlobalModal' title="全局翻译设置" modalFooter={
        <>
            <Button onClick={onClose}>{i18n('icu:close')}</Button>
        </>
        } i18n={i18n} noEscapeClose={true} noMouseClose={true}>
        <div>
            <span className={styleName.item}>
                <label className={styleName.label}>翻译服务器</label>
                <Select value={storeState.translateConfigGlobal.curServer} moduleClassName='uni-min-select' options={storeState.serverList} onChange={(curServer)=> handleChangeSetting({curServer})}/>
            </span>
            <span className={styleName.item}>
                <label className={styleName.label}>翻译渠道</label>
                <Select value={storeState.translateConfigGlobal.curChannel} moduleClassName='uni-min-select' options={storeState.channelList} onChange={(curChannel)=> handleChangeSetting({curChannel})}/>
            </span>
            <span className={styleName.item}>
                <label className={styleName.label}>自己的语言</label>
                <Select value={storeState.translateConfigGlobal.formLang} moduleClassName="uni-min-select" options={storeState.langList} onChange={(formLang)=>handleChangeSetting({formLang})}></Select>   
            </span>
            <span className={styleName.item}>
                <label className={styleName.label}>接收字体</label>
                <UniColorPick value={storeState.translateConfigGlobal.fontReceiveColor} onChange={(fontReceiveColor) => { handleChangeSetting({fontReceiveColor}) }}/>
            </span>
            <span className={styleName.item}>
                <label className={styleName.label}>发送字体</label>
                <UniColorPick value={storeState.translateConfigGlobal.fontSendColor} onChange={(fontSendColor) => { handleChangeSetting({fontSendColor}) }}/>
            </span>
            <span className={styleName.item}>
                <label className={styleName.label}>字体大小</label>
                <Select value={storeState.translateConfigGlobal.fontSize} moduleClassName='uni-min-select' options={storeState.fontSizeList} onChange={(fontSize)=> handleChangeSetting({fontSize})}/>
            </span>
            <span className={styleName.item}>
                <label className={styleName.label}>反译</label>
                <AxoSwitch.Root checked={storeState.translateConfigGlobal.reverseTranslation} onCheckedChange={(reverseTranslation)=>{handleChangeSetting({reverseTranslation})}}/>
            </span>
            <b className={styleName.title}>应用默认值
                <small style={{ 
                    marginLeft: '10px',
                    fontWeight: 'normal',
                    color: '#999'}}>好友可独立设置
                </small>
            </b>
            <span className={styleName.item}>
                <label className={styleName.label}>接收翻译</label>
                <AxoSwitch.Root checked={storeState.translateConfigGlobal.receiveTranslate} onCheckedChange={(receiveTranslate)=>{handleChangeSetting({receiveTranslate})}}/>
            </span>
            <span className={styleName.item}>
                <label className={styleName.label}>发送翻译</label>
                <AxoSwitch.Root checked={storeState.translateConfigGlobal.sendTranslate} onCheckedChange={(sendTranslate)=>{handleChangeSetting({sendTranslate})}}/>
            </span>
            <span className={styleName.item}>
                <label className={styleName.label}>对方的语言</label>
                <Select value={storeState.translateConfigGlobal.toLang} moduleClassName="uni-min-select" options={storeState.langList} onChange={(toLang)=>handleChangeSetting({toLang})}></Select>   
            </span>
        </div>
    </Modal>)
}