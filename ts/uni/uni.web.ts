import { method } from "lodash"
import { LOCA_STORAGE_KEY } from "./uni.constant"
import { uniStore } from "./uni.store"
import { createLogger } from "../logging/log.std"
import { uniHttpApi } from "./uni.web.utls"
import { uniIpc } from "./uni.preload"

const log = createLogger('uniWeb')
const _getRandomInt =(min = 0, max = 10) => {
    return Math.floor(Math.random() * (max - min + 1)) + min
}

const _loadServerList = async ()=>{
    // if(window.baseServer){
        const config = await uniIpc.getConfig()        
        const ServerList:any = [{
                    id:0,
                    value:'https://api.uniaichat.com',
                    text:'服务器一',
                    isOver:0
                }
            ] 
            log.info('获取来源配置configconfig',config,ServerList)
            uniStore.dispatch({ type:'SET_SERVER_LIST',payload:ServerList})
        const len = ServerList.length
        if(len){          
            const serverNum = _getRandomInt(0,len-1)
            const curServer = ServerList[serverNum].value;
            uniStore.dispatch({ type:'SET_TRANSLATE_CONFIG_GLOBAL',payload:{curServer}})
        }
    // }
}
const _initLoginUser = async () =>{
    const result = await uniHttpApi.getLoginUser()
    console.log(result)
    if(result.code === 200){
        uniStore.dispatch({ type:'SET_USER_INFO',payload:result.data || {}})
        _initLangList()

    }
    log.info('查询软件登录信息===>',result)
}
const _initLangList = async ()=>{
    const result = await uniHttpApi.getLangList()
    if(result.code === 200){
        const langMap:any = {}
        const langList = result?.data?.map((i:any) =>{
            langMap[i.en] = i
            return {                
                value:i.en,
                text:i.name
            }
        })
        const state = uniStore.getState()
        uniStore.dispatch({ type:'SET_LANG_LIST',payload:langList || []}) 
        uniStore.dispatch({ type:'SET_LANG_MAP',payload:langMap || []}) 

        
        // 切换套餐后语种不存在时，设置为对应默认语言
        const defaultToLang = 'English' //对方默认英文
        const defaultFormLang = 'ChineseSimplified' ;//自己默认中文
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
            uniStore.dispatch({ type:'SET_TRANSLATE_CONFIG_GLOBAL',payload:globalConfig})
        }
        // 联系人列表
        const chats = state.translateConfigChat
        let isEditChats = false       
        if(isEditChats){
            uniStore.dispatch({ type:'SET_TRANSLATE_CONFIG_CHAT',payload:chats})
        }
        // 当前联系人
        const curChat = state.curChat
        let isEditCurChat = false
        if(isEditCurChat){
            uniStore.dispatch({ type:'SET_CUR_CHAT',payload:curChat})
        }


    }
}
const _initChannelList = async () =>{
    const result = await uniHttpApi.getChannelList()
    if(result.code === 200){
        const channelList = result?.data?.map((i:any) =>({
            value:i.key,
            text:i.name
        }))
        uniStore.dispatch({ type:'SET_CHANNEL_LIST',payload:channelList || []}) 
        const curChannel = channelList[0].value
        uniStore.dispatch({ type:'SET_TRANSLATE_CONFIG_GLOBAL',payload:{curChannel}})
    }

}
window.initUniWeb = async ()=>{
    await _loadServerList();
    await _initChannelList()
    _initLoginUser()
}
