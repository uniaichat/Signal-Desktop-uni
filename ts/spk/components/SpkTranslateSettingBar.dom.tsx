
import React, { useState, ReactNode, SetStateAction, useEffect } from 'react';
import { AxoSwitch } from '../../axo/AxoSwitch.dom';
import { AxoSymbol } from '../../axo/AxoSymbol.dom';
import { tw } from '../../axo/tw.dom';
import { SpkTranslateSettingGlobalModal } from './SpkTranslateSettingGlobalModal.dom';
import { Select } from '../../components/Select.dom';
import { spkStore } from '../spk.store';
const styleName = {
    bar:tw('flex items-center h-[30px]'),
    item:tw('flex items-center mx-2 whitespace-nowrap text-[12px]'),
}
export function SpkTranslateSettingBar({chatId}:any){
    const state = spkStore.getState();
    const globalCfg = state.translateConfigGlobal;
    const [curServer, setCurServer] = useState(globalCfg.curServer)
    const [serverList, setServerList] = useState(state.serverList)
    const [langList, setLangList] = useState(state.serverList)
    const [curChat, setCurChat] = useState(state.curChat)
    const [showGlobal, setShowGlobal] = useState(false)
    const handleTriggerGlobal = (val:SetStateAction<boolean>) =>{
      setShowGlobal(val)
    }
    const handleCurChatConfigChange = (config:any) =>{
      const newCon = {...curChat, ...config}
      setCurChat(newCon)
      spkStore.dispatch({type:'SET_TRANSLATE_CONFIG_CHAT',payload:{chatId, config:newCon}})
    }
    useEffect(() => {
      const unsubscribe = spkStore.subscribe(() => {
        const state = spkStore.getState();
        setCurServer(state.translateConfigGlobal.curServer);
        setServerList(state.serverList);
        setCurChat(state.curChat);
        setLangList(state.langList);
        
      });

      return () => unsubscribe();
    }, []);
    useEffect(()=>{
      const state = spkStore.getState();
      const exist = state.translateConfigChat[chatId];

      const next = exist || {
        id: chatId,
        formLang: globalCfg.formLang,
        toLang: globalCfg.toLang,
        sendTranslate: globalCfg.sendTranslate,
        receiveTranslate: globalCfg.receiveTranslate,
      };

      if (JSON.stringify(next) !== JSON.stringify(state.curChat)) {
        spkStore.dispatch({ type: 'SET_CUR_CHAT', payload: next });
      }
    }, [chatId]);
    return(<>
      <div className={styleName.bar}>
          <span className={styleName.item} onClick={()=>handleTriggerGlobal(true)}><AxoSymbol.InlineGlyph symbol='settings' label={null}/> </span>
          <span className={styleName.item}>            
            <Select value={curServer} moduleClassName='spk-min-select' options={serverList} onChange={(curServer)=> spkStore.dispatch({type:'SET_TRANSLATE_CONFIG_GLOBAL',payload:{curServer}})}/>
          </span>
          <span className={styleName.item}>发送翻译<AxoSwitch.Root checked={curChat.sendTranslate} onCheckedChange={(sendTranslate)=>handleCurChatConfigChange({sendTranslate})}/></span>
          <span className={styleName.item}>接收翻译<AxoSwitch.Root checked={curChat.receiveTranslate} onCheckedChange={(receiveTranslate)=>handleCurChatConfigChange({receiveTranslate})}/></span>
          {/* <span className={styleName.item}>禁发中文<AxoSwitch.Root checked={true} onCheckedChange={handleChange}/></span> */}
          <span className={styleName.item}>
              <label>对方语言</label>
              <Select value={curChat.toLang} moduleClassName="spk-min-select" options={langList} onChange={(toLang)=>handleCurChatConfigChange({toLang})}></Select>           
          </span>
          <span className={styleName.item}>
              <label>自己语言</label>
              <Select value={curChat.formLang} moduleClassName="spk-min-select" options={langList} onChange={(formLang)=>handleCurChatConfigChange({formLang})}></Select>           
          </span>
      </div>
      
      {showGlobal && (<SpkTranslateSettingGlobalModal onClose={()=>handleTriggerGlobal(false)}/>)}
    </>)
}