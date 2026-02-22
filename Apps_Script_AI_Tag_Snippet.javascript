// ============================================================
// 🤖 🚀 AI 핵심 태그 추출 로직 (Gemini API 연동)
// [사용법] 
// 1. 이 코드를 앱스 스크립트(.gs)의 빈 공간에 복사합니다.
// 2. 방문일지가 폼으로 접수되는 doPost() 나 onEdit() 함수 안에서
//    extractTagsAndSave(방문일지결과텍스트, 시트객체, 기록할행번호) 형태로 호출하세요.
// ============================================================

const GEMINI_API_KEY = "발급받은_GEMINI_API_키를_여기에_넣으세요";

function extractKeyTagsWithGemini(visitNotes) {
  if (!visitNotes || visitNotes.trim() === '') return '';

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  
  const prompt = `
  다음은 현장 영업사원이 작성한 거래처 미팅 방문일지입니다:
  "${visitNotes}"

  지시사항:
  위 내용에서 영업 타겟팅(업셀링, 방어)에 유효한 핵심 카테고리 태그를 3개 이하로 추출하세요.
  태그는 명사형 단답으로, 반드시 콤마(,)로만 구분하여 반환하세요.
  설명이나 따옴표 없이 결과만 출력하세요. (예시: 치즈니즈, 타사불만, 가격저항)
  `;

  const payload = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      temperature: 0.1, // 창의성 낮추고 정확도 높임
      maxOutputTokens: 20
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const json = JSON.parse(response.getContentText());
    
    if (json.candidates && json.candidates[0].content.parts[0].text) {
      let tags = json.candidates[0].content.parts[0].text.trim();
      // 혹시라도 구글시트 필터링 충돌을 막기 위해 띄어쓰기 제거
      tags = tags.replace(/ /g, ''); 
      return tags;
    }
  } catch (e) {
    Logger.log("Gemini Tag Extraction Error: " + e.toString());
  }
  
  return '';
}

// ----------------------------------------------------
// (예시) 실제 데이터 저장 시 호출 방법
// ----------------------------------------------------
function example_SaveVisitLog(newRowData) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('방문일지');
  const lastRow = sheet.getLastRow() + 1;
  const visitNoteIndex = 5; // 방문일지 내용이 적힌 칼럼 인덱스 (가정)
  const aiTagColumnIndex = 12; // "AI_핵심태그" 칼럼이 L열(12)이라고 가정
  
  const rawNotes = newRowData[visitNoteIndex];
  
  // 1. 기존 데이터 삽입 (예: sheet.getRange(lastRow, 1, 1, newRowData.length).setValues([newRowData]);)
  
  // 2. 백그라운드에서 AI 태그 추출
  const generatedTags = extractKeyTagsWithGemini(rawNotes);
  
  // 3. AI 태그 칼럼 업데이트
  if(generatedTags !== '') {
    sheet.getRange(lastRow, aiTagColumnIndex).setValue(generatedTags);
  }
}
