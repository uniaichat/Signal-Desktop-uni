import { SpkToast } from './components/spkToast';
import { spkStore } from './spk.store';
import { verifyLangUtls } from './spk.web.verifyLang';

export const spkUtils = {
    async messageTranslate({to,text,forceRefresh}:{to:String,text:String,forceRefresh?:boolean}) {      
        if(!forceRefresh){
            const cache = await window.spkIpc.getTranslateCache({to,text})
            if(cache){
                return  {translation:[cache]}
            }            
        }  
        const result = await spkHttpApi.translate({
            from: '',to,text,
        });        
        if (result.code == 0) {
            const res = result.data.result;
            const translation = res.translation[0]
            window.spkIpc.setTranslateCache({to,text,translation})
            return res;
        } else {
            return result;
        }
    },
    
      /**
       * 语音翻译，加扣字符
       * @param {*} file 
       */
      async messageAudioTranslate(body:any){
        // let formData = new FormData();
        // formData.append('file', file)
        const result = await spkHttpApi.translateAudio({
              body,
            })
        if (result.code == 0) {
            const res = result.data.result;
            // const translation = res.translation[0]
            // window.spkIpc.setTranslateCache({to,text,translation})
            return res;
        } else {
            return result;
        }
      },
    async fetch(config: any) {
        const result = await window.spkIpc.fetch({
            ...config,
            url: `${spkStore.getState().translateConfigGlobal.curServer}/${config.url}`,
        });
        if (result.code === 4000) {
            SpkToast.error('登录失效，请在主程序中重新登录后打开Signal');
        } else if (result.code !== 0) {
            SpkToast.error(result.message);
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
};
export const spkHttpApi = {
    translate: ({ from, to, text }: any) => spkUtils.fetch({
        urlToken: false,
        method: 'POST',
        url: `youdao/q`,
        body: { from, to, text },
    }),
    translateAudio: ({body}:any) => spkUtils.fetch({
        method: 'POST',
        url: `youdao/uploadWav`,
        body,
    }),
    aiReply: ({body}:any) => spkUtils.fetch({
        method: 'POST',
        url: `openAPI/autoReply`,
        body,
    }),
    getLoginUser: () => spkUtils.fetch({
        method: 'POST',
        url: `user/loginWithToken`,
        params: {
            flag: false
        }
    }),
    getLangList: (type: number) => spkUtils.fetch({
        method: 'GET',
        url: `language/getSupport`,
        params: {
            type
        }
    }),
};
