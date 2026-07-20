
import React, { useState, useEffect, SetStateAction } from 'react';
import { AxoSwitch } from '../../axo/AxoSwitch.dom';
import { AxoSymbol } from '../../axo/AxoSymbol.dom';
import { tw } from '../../axo/tw.dom';
import { Select } from '../../components/Select.dom';
import { uniStore } from '../uni.store';
import {UniTranslateSettingGlobalModal} from './UniTranslateSettingGlobalModal.dom' 
const styleName = {
    bar:tw('flex items-center h-[30px]'),
    item:tw('flex items-center mx-2 whitespace-nowrap text-[12px]'),
}
export function UniTranslateSettingBar({chatId}:any){
    const state = uniStore.getState();
    const globalCfg = state.translateConfigGlobal;
    const [channelList, setChannelList] = useState(state.channelList)
    const [curChannel, setCurChannel] = useState(globalCfg.curChannel)
    const [langList, setLangList] = useState(state.langList)
    const [curChat, setCurChat] = useState(state.curChat)
    const [showGlobal, setShowGlobal] = useState(false)
    const handleTriggerGlobal = (val:SetStateAction<boolean>) =>{
      setShowGlobal(val)
    }
    const handleCurChatConfigChange = (config:any) =>{
      const newCon = {...curChat, ...config}
      setCurChat(newCon)
      uniStore.dispatch({type:'SET_TRANSLATE_CONFIG_CHAT',payload:{chatId, config:newCon}})
    }
    useEffect(() => {
      const unsubscribe = uniStore.subscribe(() => {
        const state = uniStore.getState();
        setCurChannel(state.translateConfigGlobal.setCurChannel);
        setChannelList(state.channelList);
        setCurChat(state.curChat);
        setLangList(state.langList);
        
      });

      return () => unsubscribe();
    }, []);
    useEffect(()=>{
      const state = uniStore.getState();
      const exist = state.translateConfigChat[chatId];

      const next = exist || {
        id: chatId,
        toLang: globalCfg.toLang,
        sendTranslate: globalCfg.sendTranslate,
        receiveTranslate: globalCfg.receiveTranslate,
      };

      if (JSON.stringify(next) !== JSON.stringify(state.curChat)) {
        uniStore.dispatch({ type: 'SET_CUR_CHAT', payload: next });
      }
    }, [chatId]);
    return (<>
      <div className={styleName.bar}>
        <span className={styleName.item} onClick={()=>handleTriggerGlobal(true)}><AxoSymbol.InlineGlyph symbol='settings' label={null}/> </span>
        {/* <span className={styleName.item}>
            <label>翻译通道</label>
             <Select value={curChannel} moduleClassName='uni-min-select' options={channelList} onChange={(curChannel)=> uniStore.dispatch({type:'SET_TRANSLATE_CONFIG_GLOBAL',payload:{curChannel}})}/>
        </span> */}
        <span className={styleName.item}>
            <label>接收翻译</label>
            <AxoSwitch.Root checked={curChat.receiveTranslate} onCheckedChange={(receiveTranslate)=>handleCurChatConfigChange({receiveTranslate})}/>
        </span>
        <span className={styleName.item}>
            <label>发送翻译</label>
            <AxoSwitch.Root checked={curChat.sendTranslate} onCheckedChange={(sendTranslate)=>handleCurChatConfigChange({sendTranslate})}/>
        </span>
        {/* <span className={styleName.item}>
            <label>我的语言</label>
              <Select value={curChat.formLang} moduleClassName="uni-min-select" options={langList} onChange={(formLang)=>handleCurChatConfigChange({formLang})}></Select>    
        </span> */}
        <span className={styleName.item}>
            <label>对方语言</label>
            <Select value={curChat.toLang}  moduleClassName="uni-min-select" options={langList} onChange={(toLang)=>handleCurChatConfigChange({toLang})}></Select>  
        </span>
        <small>8.17.110</small>
      </div>
      {showGlobal && (<UniTranslateSettingGlobalModal onClose={()=>handleTriggerGlobal(false)}/>)}

    </>)
}