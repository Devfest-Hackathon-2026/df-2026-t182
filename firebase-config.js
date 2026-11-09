// Firebase の接続先。プロジェクトを移すときは、このファイルだけを書き換える（Webアプリの設定値は秘密ではない。鍵やトークンは置かない）。
// 書き換えたあと、.firebaserc の default も新しいプロジェクトIDにする（ルールのデプロイ先）。
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBhh8eAX0oVXuFK9Su52AwAR3-ACidf9Lg',
  authDomain: 'project-8f7193a2-11b6-480f-9f5.firebaseapp.com',
  projectId: 'project-8f7193a2-11b6-480f-9f5',
  storageBucket: 'project-8f7193a2-11b6-480f-9f5.firebasestorage.app',
  messagingSenderId: '419441966285',
  appId: '1:419441966285:web:1117fc45e03da4f6d63d84'
};
// 手元（localhost・127.0.0.1）で開いたときはエミュレーターにつなぐ。手元から本番につなぎたいときは URL に ?fb=live を付ける。
export const EMULATOR = { auth: 'http://127.0.0.1:9099', firestoreHost: '127.0.0.1', firestorePort: 8085 };
