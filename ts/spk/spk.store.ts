import { createStore } from 'redux';
import { LOCA_STORAGE_KEY } from './spk.constant';
const translateConfigGlobalCache = localStorage.getItem(LOCA_STORAGE_KEY.GLOBAL_CONFIG)
const translateConfigChatCache = localStorage.getItem(LOCA_STORAGE_KEY.CHAT_CONFIG)
const initialState = {
    userInfo:{},
    serverList : [],
    langList:[],
    langMap:{},
    fontSizeList:[{value:12,text:'12px'},{value:14,text:'14px'},{value:16,text:'16px'},{value:18,text:'18px'}],
    translateConfigGlobal:translateConfigGlobalCache ? JSON.parse(translateConfigGlobalCache) : {
        curServer:'',
        fontColor: '#000',
        fontSize:'14',
        sendTranslate:true,
        receiveTranslate:true,
        notSendChinese:true,
        formLang:'zh',
        toLang:'en'
    },
    translateConfigChat:JSON.parse(translateConfigChatCache || '{}'),
    curChat:{}
};

function reducer(state = initialState, action:any) {
  switch (action.type) {
    case 'SET_USER_INFO':
      return { ...state, userInfo: action.payload };
    case 'SET_TRANSLATE_CONFIG_GLOBAL':
        const newTranslateConfigGlobal = {...state.translateConfigGlobal, ...action.payload}
        localStorage.setItem(LOCA_STORAGE_KEY.GLOBAL_CONFIG, JSON.stringify(newTranslateConfigGlobal))
      return { ...state, translateConfigGlobal: newTranslateConfigGlobal};
    case 'SET_TRANSLATE_CONFIG_CHAT':
        const oldChat = state.translateConfigChat[action.payload.chatId] || {}
        const newChat = {
            id:action.payload.chatId,
            ...oldChat,
            ...action.payload.config
        }
        const newAllChatCon = {
            ...state.translateConfigChat,
            [action.payload.chatId]: newChat
        };
        localStorage.setItem(LOCA_STORAGE_KEY.CHAT_CONFIG, JSON.stringify(newAllChatCon))
      return { ...state, translateConfigChat: newAllChatCon, curChat:newChat};
    case 'SET_SERVER_LIST':
      return { ...state, serverList: action.payload };
    case 'SET_LANG_LIST':
      return { ...state, langList: action.payload };
    case 'SET_LANG_MAP':
      return { ...state, langMap: action.payload };
    case 'SET_CUR_CHAT':
      return { ...state, curChat: {...action.payload} };
    default:
      return state;
  }
}

export const spkStore = createStore(reducer);
window.spkStore = {
    dispatch:spkStore.dispatch,
    getState: spkStore.getState,
    subscribe: spkStore.subscribe,
}