/* ============================================================================
   課程註冊表
   ----------------------------------------------------------------------------
   教材有兩種來源，兩邊都用同一個結構（課程 → 單元 → 單字）：

   1) 內建課程：放在 courses/*.js，每個檔案呼叫一次 TVJ.register({...})，
      並在 index.html 加一行 <script src="courses/xxx.js"></script>。
      適合沒有版權疑慮、可以公開的教材（例如每日 YouTube 影片）。

   2) 教材包：有版權、不能上公開網路的教材（例如國際學村單字大全）做成
      .json 檔放自己的雲端硬碟，在 App 的 ⚙️ 設定 →「匯入教材包」匯入。
      資料存在瀏覽器本機（IndexedDB），不會進 git、不會上傳。
      教材包格式：{ pack:'包id', name:'顯示名稱', courses:[ {課程物件} ] }
      單元裡寫 audioFile:'day01_all.mp4'，匯入時一起選那個音檔即可。

   進度鍵是「課程id/單元id/w序號」，兩種來源共用同一套進度，互不干擾。
   ========================================================================== */
const TVJ = {
  courses: [],
  register(c) {
    if (!c || !c.id) return;
    const i = this.courses.findIndex(x => x.id === c.id);
    if (i >= 0) this.courses[i] = c; else this.courses.push(c);
  }
};
const DATA = { courses: TVJ.courses };
