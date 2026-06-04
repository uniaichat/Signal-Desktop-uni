import { UniToast } from './components/UniToast';
import { uniStore } from './uni.store';
import { verifyLangUtls } from './uni.web.verifyLang';

export const uniUtils = {
    async messageTranslate({to,text,forceRefresh}:{to:string,text:string,forceRefresh?:boolean}) {    
        const uniStoreState =   uniStore.getState()
        if(!forceRefresh){
            const cache = await window.uniIpc.getTranslateCache({to,text})
            if(cache){
                return  {data:[cache]}
            }            
        }
        const curChannel = uniStoreState.translateConfigGlobal.curChannel
        const result = await uniHttpApi.translate({
            from: '',
            to:uniUtils.getLangCodeByChannel(to, curChannel),
            text,
            channel:curChannel,
            style:2
        });        
        if (result.code == 200) {
            const translation = result.data
            window.uniIpc.setTranslateCache({to,text,translation})
            return result;
        } else if (result.code == 508) {
            window.uniIpc.setTranslateCache({to,text,translation:text})
            return result;
        } else  {
            window.uniIpc.setTranslateCache({to,text,translation:result.msg})
            return result;
        }
    },
    async fetch(config: any) {
        const result = await window.uniIpc.fetch({
            ...config,
            url: `${uniStore.getState().translateConfigGlobal.curServer}/${config.url}`,
        });
            console.log(config,'-----',result)
        if (result.code === 400) {
            UniToast.error('登录失效，请在主程序中重新登录后打开Signal');
        } else if (result.code !== 200 && result.code !== 508) {
            UniToast.error(result.msg);
        }
        return result;
    },
    // 按理所有语言判断得按照这个来
    sendMessageVerifyLang(toCode: string, text: string) {
        const txt = text.replace(/\p{Emoji}/gu, '');
        // 如果没有内容返回 false,防止只发表情包发不出消息
        if (!txt) {
            return false;
        }
        // 1. 纯符号、数字、常见 emoji 范围
        const onlySymbolsOrEmoji =
            /^[~|$￥^=><\s\d+*/.\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F018}-\u{1F270}\u{1F300}-\u{1F5FF}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1FA70}-\u{1FAFF}\u{1F3FB}-\u{1F3FF}]+$/u;

        // 2. 仅由空格、数字、标点、emoji 构成
        const punctuationEmojiOnly = /^[\s\d\p{P}\p{Emoji}1️⃣2️⃣3️⃣⏰❤️🏴^]+$/gu;

        // 3. 邮箱地址
        const isEmail = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

        // 4. URL 链接
        const isURL = /^(http|https):\/\/[^\s/$.?#].[^\s]*$/;
        if (
            onlySymbolsOrEmoji.test(txt) ||
            punctuationEmojiOnly.test(txt) ||
            isEmail.test(txt) ||
            isURL.test(txt)
        ) {
            return false;
        }
        // 如果目标语言是日文，韩文则优先检测是否为日文，韩文
        if (['ja', 'JA', 'Japanese'].includes(toCode)) {
            return verifyLangUtls.detect(txt) !== 'ja';
        }
        if (['ko', 'KO', 'Korean'].includes(toCode)) {
            return verifyLangUtls.detect(txt) !== 'ko';
        }
        return /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFA2D]/.test(txt);
    },
    invertHex(hex: String) {
        hex = hex.replace('#', '');
        if (hex.length === 3)
            hex = hex
                .split('')
                .map(c => c + c)
                .join('');

        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);

        // 亮度公式：Y = 0.299*R + 0.587*G + 0.114*B
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;

        return brightness > 125 ? '#000000' : '#FFFFFF';
    },
    getLangCodeByChannel(lang:string,channel:string){
        const uniStoreState =   uniStore.getState()
        const langItem = uniStoreState.langMap[lang].channelCodeList.find((i:any) => i.channel === channel)
        return langItem.abrige
    }
};
export const uniHttpApi = {
    translate: (data: any) => uniUtils.fetch({
        method: 'POST',
        url: `client/translate`,
        body: data,
    }),
    getLoginUser: () => uniUtils.fetch({
        method: 'get',
        url: `client/customerDetail`
    }),
    getLangList: () => uniUtils.fetch({
        method: 'GET',
        url: `client/index/languages`
    }),    
    getChannelList: () => uniUtils.fetch({
        method: 'GET',
        url: `client/translate/channels`
    }),
};
