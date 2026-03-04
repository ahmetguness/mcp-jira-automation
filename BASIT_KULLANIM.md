# 🤖 AI Cyber Bot - Basit Kullanım Kılavuzu

Merhaba! Bu kılavuz, kodlama veya yazılım mimarisi bilmeyen birinin bile "AI Cyber Bot" sistemini nasıl kurup çalıştırabileceğini anlatmak için hazırlanmıştır.

---

## 🧐 Bu Sistem Ne İşe Yarar?

Düşünün ki şirketinize hiç uyumayan, süper hızlı bir yazılım geliştirici aldınız. Adı: **AI Cyber Bot**.
Bu sistemin yaptığı iş sırasıyla şudur:
1. **Jira'ya Bakar:** Kendisine (AI Cyber Bot) atanmış ve henüz bitmemiş bir görev var mı diye kontrol eder.
2. **Kodu Çeker:** Görevle ilgili projenin kodlarını (GitHub, GitLab veya Bitbucket üzerinden) bilgisayara indirir.
3. **Yapay Zeka ile Düşünür:** "Görevi yapmak için hangi dosyaları değiştirmeliyim?" diye düşünür ve kodu yazar. (OpenAI, Claude, Gemini gibi yapay zekaları kullanır).
4. **Güvenli Test Eder:** Yazdığı kodu kendi bilgisayarınızı bozmaması için kapalı bir kutu (Docker) içinde test eder.
5. **Kodu Teslim Eder:** Yazdığı kodları onaylamanız için "Pull Request" (PR) olarak sisteme yükler.
6. **Jira'yı Günceller:** Görevin altına "Kodu yazdım, test ettim, işte linki!" diye yorum atar ve görevin durumunu günceller.

---

## 🛠️ Sistemin Parçaları Ne İşe Yarar?

Programın arka planında çalışan parçaların basit açıklamaları:

* **Jira Müşterisi:** Şirketinizin görev takip sistemine bağlanıp işleri okuyan sekreterinizdir.
* **SCM (Git) Bağlantısı:** Kodların tutulduğu depoya (GitHub vb.) gidip dosyaları alan kuryedir.
* **Yapay Zeka (AI) Beyni:** Sorunu çözüp kod yazan sanal mühendisinizdir.
* **Docker İzolatörü:** Yapay zekanın yazdığı kod bilmeden virüslü veya hatalı olabilir diye denemelerin yapıldığı "çelik kasa" veya "kum havuzu"dur. Kasa dışına zarar verilemez.
* **MCP (Model Context Protocol):** Farklı sistemlerin (Jira, Github vb.) yapay zeka ile aynı dili konuşmasını sağlayan çevirmendir.

---

## 🚀 Sistemi Nasıl Çalıştırırım?

Sistemi çalıştırmak sadece 3 adımdan oluşur.

### Adım 1: Ayar Dosyasını Doldurmak
Programın Jira şifrenizi veya Yapay Zeka anahtarınızı bilmesi gerekir. 
1. Proje klasöründeki `.env.example` isimli dosyayı kopyalayın ve adını `.env` yapın.
2. `.env` dosyasını Not Defteri ile açın.
3. İçindeki boş bırakılmış anahtarları doldurun *(Örn: JIRA_EMAIL=isminiz@sirket.com)*.

*Önemli Not:* Bilgisayarınızda **Docker Desktop** uygulamasının açık ve çalışıyor olduğundan emin olun! Açık değilse kapalı kutu testleri yapılamaz.

### Adım 2: Programı Kurmak
Bilgisayarınızın terminalini (Komut İstemini veya PowerShell'i) açın ve projenin içine girip şu komutu yazıp `Enter`'a basın:
```bash
npm install
```
*(Bu komut, programın ihtiyaç duyduğu ek dosyaları internetten indirir. Sadece 1 kez yapmanız yeterlidir.)*

### Adım 3: Sistemi Başlatmak
Her şey hazır! Sistemi başlatmak için şu komutu yazıp `Enter`'a basın:
```bash
npm run dev
```

**Tebrikler! 🎉** 
Ekranda yeşil yazılar akmaya başlayacak. Artık Jira üzerinden "AI Cyber Bot" kullanıcısına bir görev atadığınızda, gerisini bot kendisi halledecektir.
