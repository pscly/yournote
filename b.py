import os
import requests

auth = (os.environ.get("NIDERIJI_AUTH") or "").strip()
if not auth:
    raise RuntimeError("缺少认证信息：请设置环境变量 NIDERIJI_AUTH（例如：token eyJhbGci...）")

url = "https://nideriji.cn/api/write/"

payload = {
  'content': '''
[15:53]
emmm 突然又感觉时间过得好快啊，一转眼又周五了，我周末还没想好怎么安排…
总不能又像是上周一样当特种兵吧，腿都要走软了，算辣，晚上再说吧

[18:11]
我去，到家的时候又忘记锁共享单车了，怎么每次骑共享单车的时候都要忘记锁车，我晕

[19:02]
算辣，打算出去觅食，不想在家里搞，毕竟周末了，出去看看有没想吃的

[19:45]
完全没有想吃的，而且感觉一个人在外面瞎逛，心情有点乱，emmm，似乎是触发了不好的回忆？
我想好了，明天或者后天再出门一趟吧，我总不能一直失败吧，我真的是就第一次成功了，后面一次没成功，(2025-10-19成功) 然后直到今天，要么是遗憾，要么是失败，好吧，明天或者后天出门再说吧，现在先回家，心情有点差，精力也很差

[20:59]
不得不说，空气炸锅是真方便，早上想吃熔岩面包 直接就能烤，晚上想吃烧烤 ，也是想吃什么就烤什么，不得不说 这幸福感太强了
回来路上买了土豆，青椒，茄子
打算在家自己搞点烧烤吃吃，有点想试试围炉煮茶，但是又感觉烧炭处理太麻烦，(那我买这么多装备是干啥用的，我真的有点想不通，不过 烤土豆片是真好吃，剩下的后面在想吧)

[21:08]
虽然煮茶懒得搞，但是泡个茶还是可以的，毕竟买了那么多，不泡的不是纯浪费吗？

[21:15]
感谢wcy的提醒，烤茄子的时候差点忘记放葱

[22:40]
好吧虽然这几个月一直失败，但是刚才又被刺激了一下，明天或者后天我必须出门，继续挑战，上次的问题，上上次的问题我都有进步和改善，这次我一定要成功，至少要收获经验，我不能再这样消极了........



''',
  'date': '2026-01-09'
}

headers = {
  'User-Agent': "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
  'accept-language': "zh,en;q=0.9,zh-CN;q=0.8,zh-TW;q=0.7",
  'auth': auth,
  'cache-control': "no-cache",
  'origin': "https://nideriji.cn",
  'pragma': "no-cache",
  'priority': "u=1, i",
  'referer': "https://nideriji.cn/w/write",
  'sec-ch-ua': "\"Google Chrome\";v=\"143\", \"Chromium\";v=\"143\", \"Not A(Brand\";v=\"24\"",
  'sec-ch-ua-mobile': "?0",
  'sec-ch-ua-platform': "\"Windows\"",
  'sec-fetch-dest': "empty",
  'sec-fetch-mode': "cors",
  'sec-fetch-site': "same-origin"
}

response = requests.post(url, data=payload, headers=headers)

print(response.text)
