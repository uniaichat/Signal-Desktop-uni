import { method } from "lodash"
import { LOCA_STORAGE_KEY } from "./spk.constant"
import { spkStore } from "./spk.store"
import { createLogger } from "../logging/log.std"
import { spkHttpApi } from "./spk.web.utls"
import { spkIpc } from "./spk.preload"

const log = createLogger('spkWeb')
const _getRandomInt =(min = 0, max = 10) => {
    return Math.floor(Math.random() * (max - min + 1)) + min
}

const _loadServerList = async ()=>{
    // if(window.baseServer){
        const config = await spkIpc.getConfig()
        
        const ServerList:any = config?.channel === 'happy' ? [{
                    id:0,
                    value:'https://app.happyworld88.com',
                    text:'服务器一',
                    isOver:0
                },{
                    id:1,
                    value:'https://app.happyworldzy.cn',
                    text:'服务器二',
                    isOver:0
                },{
                    id:2,
                    value:'https://ipone.happyworldpro.com',
                    text:'服务器三',
                    isOver:0
                },{
                    id:3,
                    value:'https://iptwo.happyworldpro.com',
                    text:'服务器四',
                    isOver:0
                }
            ] : [{
                id:0,
                value:'https://ipone.speakworldapp.com',
                text:'服务器一',
                isOver:0
            },{
                id:1,
                value:'https://iptwo.speakworldapp.com',
                text:'服务器三',
                isOver:0
            },{
                id:2,
                value:'https://appusa.okfanyi88.com',
                text:'美国服务器',
                isOver:0
            },{
                id:3,
                value:'https://apptai.okfanyi88.com',
                text:'泰国服务器',
                isOver:0
            },{
                id:4,
                value:'https://appbak.okfanyi88.com',
                text:'备用服务器',
                isOver:0
            }
        ]
            log.info('获取来源配置configconfig',config,ServerList)
            spkStore.dispatch({ type:'SET_SERVER_LIST',payload:ServerList})
        const len = ServerList.length
        if(len){          
            const serverNum = _getRandomInt(0,len-1)
            const curServer = ServerList[serverNum].value;
            spkStore.dispatch({ type:'SET_TRANSLATE_CONFIG_GLOBAL',payload:{curServer}})
        }
    // }
}
const _initLoginUser = async () =>{
    const result = await spkHttpApi.getLoginUser()
    if(result.code === 0){
        spkStore.dispatch({ type:'SET_USER_INFO',payload:result.data || {}})
        _initLangList(result.data.vipType)

    }
    log.info('查询软件登录信息===>',result)
}
const _initLangList = async (vipType:number)=>{
    const result = await spkHttpApi.getLangList(vipType)
    if(result.code === 0){
        const langMap:any = {}
        const langList = result?.data?.map((i:any) =>{
            langMap[i.abridge] = i
            return {                
                value:i.abridge,
                text:i.name
            }
        })
        const state = spkStore.getState()
        spkStore.dispatch({ type:'SET_LANG_LIST',payload:langList || []}) 
        spkStore.dispatch({ type:'SET_LANG_MAP',payload:langMap || []}) 

        
        // 切换套餐后语种不存在时，设置为对应默认语言
        const defaultToLang = langMap['en']?.abridge || langMap['EN-US']?.abridge ||langMap['en']?.abridge //对方默认英文
        const defaultFormLang = langMap['zh-CHS']?.abridge || langMap['zh-CN']?.abridge ||langMap['ZH']?.abridge ;//自己默认中文
        // 全局
        const globalConfig = state.translateConfigGlobal
        let isEditGlobal = false
        if(!langMap[globalConfig.toLang]){
            isEditGlobal = true
            globalConfig.toLang = defaultToLang
        }
        if(!langMap[globalConfig.formLang]){
            isEditGlobal = true
            globalConfig.formLang = defaultFormLang
        }
        if(isEditGlobal){
            spkStore.dispatch({ type:'SET_TRANSLATE_CONFIG_GLOBAL',payload:globalConfig})
        }
        // 联系人列表
        const chats = state.translateConfigChat
        let isEditChats = false
        for(let key in chats ){
            if(!langMap[chats[key].toLang]){
                chats[key].toLang = defaultToLang
                if(!isEditChats)isEditChats = true
            }
            if(!langMap[chats[key].formLang]){
                chats[key].formLang = defaultFormLang
                if(!isEditChats)isEditChats = true
            }
        }        
        if(isEditChats){
            spkStore.dispatch({ type:'SET_TRANSLATE_CONFIG_CHAT',payload:chats})
        }
        // 当前联系人
        const curChat = state.curChat
        let isEditCurChat = false
        if(!langMap[curChat.toLang]){
            isEditCurChat = true
            curChat.toLang = defaultToLang
        }
        if(!langMap[curChat.formLang]){
            isEditCurChat = true
            curChat.formLang = defaultFormLang
        }
        if(isEditCurChat){
            spkStore.dispatch({ type:'SET_CUR_CHAT',payload:curChat})
        }


    }
}
window.initSpkWeb = async ()=>{
    await _loadServerList();
    _initLoginUser()

}
