// ==========================================
// 면학관 출석 관리시스템 - app.js
// (원본 <script> 블록에서 분리)
// ==========================================

// ==========================================
// 글로벌 상태 변수 관리
// ==========================================
let masterStudents = [];       // 정제 완료된 공식 데이터 리스트
let datesAvailable = [];       // 감지된 출석 관리 날짜 리스트
let selectedDate = "";         // 교사의 현재 조회 일자
let selectedPeriod = "8교시";  // 배치도에서 현재 확인할 교시
let temporaryParsedData = null;// 적용 대기 중인 임시 파싱 버퍼
let originalRawSheet = null;   // 원본 엑셀 형태 보존을 위한 SheetJS 워크시트 객체
let isTeacherAuthenticated = false; // 교사 인증 상태 변수

// 실시간 학생 체크인 데이터 저장 해시맵 {"날짜_학번_교시": "출석"}
let attendanceDatabase = {};

// 정렬 상태 제어 변수
let currentSortColumn = "seat"; // "seat" (좌석) 또는 "id" (학번)
let currentSortOrder = "asc";   // "asc" (오름차순) 또는 "desc" (내림차순)

// ------------------------------------------
window.onload = function() {
  // 1. 오늘의 날짜 상단 바 기입
  const today = new Date();
  const weekDays = ['일', '월', '화', '수', '목', '금', '토'];
  const formattedDate = `${today.getMonth() + 1}월 ${today.getDate()}일(${weekDays[today.getDay()]})`;
  
  const headerDateEl = document.getElementById('header-date');
  if (headerDateEl) {
    const spanEl = headerDateEl.querySelector('span');
    if (spanEl) spanEl.textContent = formattedDate;
  }

  // 2. 파일 드래그 바인딩 설정
  setupDragAndDrop();

  // 3. 구글 스프레드시트 데이터 불러오기
  loadSystemData();
};

// ==========================================
// 구글 스프레드시트 (Google Sheets) 연동 및 백업 로직
// ==========================================
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwsxO_-yczi0P23o0LBckTPJ0TrtMKptYvrMws3-aUdHuUdD3r266jATw7FMqiInCcurA/exec';

// 로컬 스토리지에 백업 저장
function saveToLocalStorageBackup() {
  try {
    localStorage.setItem('masterStudents', JSON.stringify(masterStudents));
    localStorage.setItem('datesAvailable', JSON.stringify(datesAvailable));
    localStorage.setItem('selectedDate', selectedDate);
    localStorage.setItem('attendanceDatabase', JSON.stringify(attendanceDatabase));
    if (originalRawSheet) {
      localStorage.setItem('originalRawSheet', JSON.stringify(originalRawSheet));
    }
  } catch (e) {
    console.error("Local backup save failed:", e);
  }
}

// 구글 시트에 데이터 비동기 저장 요청
async function saveSystemData(action, keyOrData) {
  // 항상 로컬 백업 먼저 수행
  saveToLocalStorageBackup();

  if (!GOOGLE_SCRIPT_URL || GOOGLE_SCRIPT_URL.includes("macros/s/YOUR_URL")) {
    console.log("구글 웹앱 URL이 정의되지 않아 로컬 저장소로만 동작합니다.");
    return;
  }

  try {
    let bodyData = {};
    if (action === "save_system") {
      bodyData = {
        action: "save_system",
        key: keyOrData.key,
        value: keyOrData.value
      };
    } else if (action === "log_attendance") {
      bodyData = {
        action: "log_attendance",
        date: keyOrData.date,
        student_id: keyOrData.student_id,
        name: keyOrData.name,
        period: keyOrData.period,
        status: keyOrData.status,
        attendance_database: attendanceDatabase
      };
    }

    // CORS 우회를 위해 mode: 'no-cors'를 설정해 전송합니다 (opaque 응답 반환)
    await fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData)
    });
    console.log(`구글 시트 동기화 성공: [${action}]`);
  } catch (err) {
    console.error('구글 시트 동기화 실패:', err);
    showToast("구글 시트 저장 통신 실패. 로컬 저장소에 안전하게 임시 저장되었습니다.", "warning");
  }
}

// 구글 시트에서 데이터 로드
async function loadSystemData() {
  let loadedFromCloud = false;

  if (GOOGLE_SCRIPT_URL && !GOOGLE_SCRIPT_URL.includes("macros/s/YOUR_URL")) {
    try {
      showToast("구글 스프레드시트에서 최신 데이터를 불러오는 중...", "info");
      const response = await fetch(GOOGLE_SCRIPT_URL);
      const data = await response.json();

      if (data && data.master_students && data.dates_available) {
        masterStudents = data.master_students;
        datesAvailable = data.dates_available;
        selectedDate = datesAvailable[0] || "월(8일)";
        
        if (data.attendance_database) {
          attendanceDatabase = data.attendance_database;
        }
        if (data.original_raw_sheet) {
          originalRawSheet = data.original_raw_sheet;
        }

        loadedFromCloud = true;
        showToast("구글 스프레드시트에서 데이터를 성공적으로 동기화했습니다.", "success");
      }
    } catch (err) {
      console.error('구글 시트 로드 실패:', err);
      showToast("구글 시트 연결 실패. 로컬 저장소 백업을 로드합니다.", "warning");
    }
  }

  // 구글 시트 로드 실패 또는 URL이 없는 경우 로컬스토리지 복원 진행
  if (!loadedFromCloud) {
    try {
      const savedStudents = localStorage.getItem('masterStudents');
      const savedDates = localStorage.getItem('datesAvailable');
      const savedSelectedDate = localStorage.getItem('selectedDate');
      const savedAttendance = localStorage.getItem('attendanceDatabase');
      const savedSheet = localStorage.getItem('originalRawSheet');

      if (savedStudents && savedDates) {
        masterStudents = JSON.parse(savedStudents);
        datesAvailable = JSON.parse(savedDates);
        selectedDate = savedSelectedDate || (datesAvailable[0] || "");
        
        if (savedAttendance) {
          attendanceDatabase = JSON.parse(savedAttendance);
        }
        if (savedSheet) {
          originalRawSheet = JSON.parse(savedSheet);
        }
        showToast("로컬 저장소 백업에서 데이터를 성공적으로 불러왔습니다.", "success");
      } else {
        return; // 아무 데이터도 없음
      }
    } catch (e) {
      console.error("Local backup load failed:", e);
      return;
    }
  }

  // UI 요소 활성화 및 테이블 복원
  const banner = document.getElementById('warning-banner');
  if (banner) banner.classList.add('hidden');
  
  const statusIcon = document.getElementById('upload-status-icon');
  if (statusIcon) statusIcon.classList.remove('hidden');

  initFilterDropdowns();
  
  const dateSelect = document.getElementById('filter-date');
  if (dateSelect) {
    dateSelect.value = selectedDate;
  }

  updateAttendanceTable();
  renderCompleteLayoutMap();
}

// 전체 데이터 초기화
async function clearSystemData() {
  if (confirm("정말로 등록된 모든 학생 정보와 출결 데이터를 삭제하고 초기화하시겠습니까?\n이 작업은 구글 시트의 연동 데이터도 함께 지웁니다.")) {
    try {
      // 로컬 저장소 삭제
      localStorage.removeItem('masterStudents');
      localStorage.removeItem('datesAvailable');
      localStorage.removeItem('selectedDate');
      localStorage.removeItem('attendanceDatabase');
      localStorage.removeItem('originalRawSheet');

      // 변수 초기화
      masterStudents = [];
      datesAvailable = [];
      selectedDate = "";
      attendanceDatabase = {};
      originalRawSheet = null;

      // UI 초기화
      const banner = document.getElementById('warning-banner');
      if (banner) banner.classList.remove('hidden');
      
      const statusIcon = document.getElementById('upload-status-icon');
      if (statusIcon) statusIcon.classList.add('hidden');

      const tableBody = document.getElementById('student-table-body');
      if (tableBody) {
        tableBody.innerHTML = `
          <tr>
            <td colspan="8" class="text-center py-12 text-slate-400">
              <i class="fa-solid fa-folder-open text-3xl mb-3 block text-slate-300"></i>
              '학생정보 DB 등록' 탭에서 면학관 출석부 명단 엑셀을 먼저 업로드해 주세요.
            </td>
          </tr>
        `;
      }

      const previewContainer = document.getElementById('preview-container');
      if (previewContainer) previewContainer.classList.add('hidden');

      showToast("데이터가 성공적으로 초기화되었습니다.", "success");

      // 구글 시트에 데이터 삭제 전송
      if (GOOGLE_SCRIPT_URL && !GOOGLE_SCRIPT_URL.includes("macros/s/YOUR_URL")) {
        await saveSystemData("save_system", { key: "clear_all", value: "" });
      }
    } catch (e) {
      console.error("데이터 초기화 중 오류:", e);
      showToast("초기화 처리 중 일부 오류가 발생했습니다.", "error");
    }
  }
}

function setupDragAndDrop() {
  const dropZone = document.getElementById('drop-zone');
  if (!dropZone) return;
  
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('border-blue-500', 'bg-blue-50/50');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('border-blue-500', 'bg-blue-50/50');
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('border-blue-500', 'bg-blue-50/50');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const inputEl = document.getElementById('excel-file-input');
      if (inputEl) inputEl.files = files;
      handleFileSelect({ target: { files: files } });
    }
  });
}

// 학교 이미지 부재 시 대체 SVG 탑재 로직
function showDefaultLogo(img) {
  const parent = img.parentNode;
  if (parent) {
    parent.innerHTML = `
      <svg class="w-7 h-7 text-blue-800" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 14l9-5-9-5-9 5 9 5z"></path>
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z"></path>
      </svg>
    `;
  }
}

// ==========================================
// 알림 토스트 유틸리티
// ==========================================
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `pointer-events-auto flex items-center w-full max-w-sm bg-white border border-slate-200 rounded-xl shadow-xl p-4 text-sm font-semibold text-slate-700 transition-all duration-300 translate-y-5 opacity-0`;

  let icon = '<i class="fa-solid fa-circle-info mr-2.5 text-blue-500"></i>';
  if (type === 'success') icon = '<i class="fa-solid fa-circle-check mr-2.5 text-emerald-500 animate-bounce"></i>';
  if (type === 'error') icon = '<i class="fa-solid fa-circle-exclamation mr-2.5 text-rose-500"></i>';
  if (type === 'warning') icon = '<i class="fa-solid fa-triangle-exclamation mr-2.5 text-amber-500"></i>';

  toast.innerHTML = `
    <div class="flex items-center w-full justify-between">
      <div class="flex items-center">${icon}<span>${message}</span></div>
      <button class="ml-4 text-slate-400 hover:text-slate-600 focus:outline-none"><i class="fa-solid fa-xmark"></i></button>
    </div>
  `;

  container.appendChild(toast);
  setTimeout(() => toast.classList.remove('translate-y-5', 'opacity-0'), 50);

  const closeBtn = toast.querySelector('button');
  if (closeBtn) {
    closeBtn.onclick = () => {
      toast.classList.add('opacity-0', 'scale-95');
      setTimeout(() => toast.remove(), 300);
    };
  }

  setTimeout(() => {
    if (toast.parentNode) {
      toast.classList.add('opacity-0', 'translate-y-2');
      setTimeout(() => toast.remove(), 300);
    }
  }, 4000);
}

// ==========================================
// 교사용 인증 보안 및 탭 변경 로직
// ==========================================
function switchMainTab(target) {
  const studentContent = document.getElementById('main-student-content');
  const teacherAuth = document.getElementById('main-teacher-auth');
  const teacherContent = document.getElementById('main-teacher-content');
  
  const btnStudent = document.getElementById('main-btn-student');
  const btnTeacher = document.getElementById('main-btn-teacher');

  if (target === 'student') {
    // 학생용 탭은 무조건 개방
    if (studentContent) studentContent.classList.remove('hidden');
    if (teacherAuth) teacherAuth.classList.add('hidden');
    if (teacherContent) teacherContent.classList.add('hidden');

    if (btnStudent) btnStudent.className = "flex-1 py-3.5 px-4 font-bold text-sm text-center rounded-lg transition-all flex items-center justify-center space-x-2 text-blue-900 bg-blue-100/70 shadow-sm";
    if (btnTeacher) btnTeacher.className = "flex-1 py-3.5 px-4 font-semibold text-sm text-center rounded-lg transition-all flex items-center justify-center space-x-2 text-slate-500 hover:bg-slate-50";
  } else if (target === 'teacher') {
    if (studentContent) studentContent.classList.add('hidden');
    
    // 인증 상태에 따라 바로 내부가 나타나거나 비밀번호 입력기가 나타남
    if (isTeacherAuthenticated) {
      if (teacherAuth) teacherAuth.classList.add('hidden');
      if (teacherContent) teacherContent.classList.remove('hidden');
      updateAttendanceTable();
      renderCompleteLayoutMap();
    } else {
      if (teacherAuth) teacherAuth.classList.remove('hidden');
      if (teacherContent) teacherContent.classList.add('hidden');
      const passInput = document.getElementById('teacher-password-input');
      if (passInput) setTimeout(() => passInput.focus(), 100);
    }

    if (btnStudent) btnStudent.className = "flex-1 py-3.5 px-4 font-semibold text-sm text-center rounded-lg transition-all flex items-center justify-center space-x-2 text-slate-500 hover:bg-slate-50";
    if (btnTeacher) btnTeacher.className = "flex-1 py-3.5 px-4 font-bold text-sm text-center rounded-lg transition-all flex items-center justify-center space-x-2 text-red-900 bg-red-50 border border-red-200/50 shadow-sm";
  }
}

// 패스워드 비밀번호 0611 체크
function checkTeacherPassword() {
  const passInput = document.getElementById('teacher-password-input');
  if (!passInput) return;

  const pwd = passInput.value;
  if (pwd === "0611") {
    isTeacherAuthenticated = true;
    showToast('보안 인증이 완료되었습니다. 교사용 패널을 활성화합니다.', 'success');
    
    const lockIcon = document.getElementById('lock-icon');
    if (lockIcon) lockIcon.className = "fa-solid fa-unlock text-lg text-emerald-500";
    
    // 입력창 리셋 후 뷰 갱신
    passInput.value = "";
    switchMainTab('teacher');
  } else {
    showToast('비밀번호가 올바르지 않습니다. 다시 입력해 주십시오.', 'error');
    passInput.select();
  }
}

// 교사 세션 강제 잠금
function lockTeacherMenu() {
  isTeacherAuthenticated = false;
  const lockIcon = document.getElementById('lock-icon');
  if (lockIcon) lockIcon.className = "fa-solid fa-lock text-lg text-slate-400";
  
  showToast('교사용 보안 세션이 해제 및 자동 잠금되었습니다.', 'warning');
  switchMainTab('student');
}

// 교사용 내부 2차 하부 탭 컨트롤
// ==========================================
function switchTeacherSubMenu(sub) {
  const resPanel = document.getElementById('sub-results-panel');
  const infoPanel = document.getElementById('sub-info-panel');
  
  const btnResults = document.getElementById('sub-btn-results');
  const btnInfo = document.getElementById('sub-btn-info');

  if (sub === 'results') {
    if (resPanel) resPanel.classList.remove('hidden');
    if (infoPanel) infoPanel.classList.add('hidden');

    if (btnResults) btnResults.className = "py-2.5 px-6 font-bold text-sm rounded-lg text-blue-900 bg-blue-100/80 transition-all flex items-center space-x-2";
    if (btnInfo) btnInfo.className = "py-2.5 px-6 font-semibold text-sm rounded-lg text-slate-600 hover:bg-slate-100 transition-all flex items-center space-x-2";
    
    updateAttendanceTable();
    renderCompleteLayoutMap();
  } else if (sub === 'info') {
    if (resPanel) resPanel.classList.add('hidden');
    if (infoPanel) infoPanel.classList.remove('hidden');

    if (btnResults) btnResults.className = "py-2.5 px-6 font-semibold text-sm rounded-lg text-slate-600 hover:bg-slate-100 transition-all flex items-center space-x-2";
    if (btnInfo) btnInfo.className = "py-2.5 px-6 font-bold text-sm rounded-lg text-blue-900 bg-blue-100/80 transition-all flex items-center space-x-2";
  }
}

// 시각화 형태 변경 (명렬표 ↔ 실제 배치도)
function switchViewType(type) {
  const panelTable = document.getElementById('view-panel-table');
  const panelMap = document.getElementById('view-panel-map');
  const btnTable = document.getElementById('view-btn-table');
  const btnMap = document.getElementById('view-btn-map');

  if (type === 'table') {
    if (panelTable) panelTable.classList.remove('hidden');
    if (panelMap) panelMap.classList.add('hidden');

    if (btnTable) btnTable.className = "py-1.5 px-4 font-bold text-xs rounded bg-white text-slate-800 shadow transition-all flex items-center space-x-1";
    if (btnMap) btnMap.className = "py-1.5 px-4 font-medium text-xs rounded text-slate-600 hover:bg-white/50 transition-all flex items-center space-x-1";
    updateAttendanceTable();
  } else if (type === 'map') {
    if (panelTable) panelTable.classList.add('hidden');
    if (panelMap) panelMap.classList.remove('hidden');

    if (btnTable) btnTable.className = "py-1.5 px-4 font-medium text-xs rounded text-slate-600 hover:bg-white/50 transition-all flex items-center space-x-1";
    if (btnMap) btnMap.className = "py-1.5 px-4 font-bold text-xs rounded bg-white text-slate-800 shadow transition-all flex items-center space-x-1";
    renderCompleteLayoutMap();
  }
}

// ==========================================
// 파일 업로드 및 데이터 정제 처리
// ==========================================
function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      originalRawSheet = worksheet; // 복원을 위한 시트 복제본 백업

      const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      if (rawData.length < 3) {
        showToast('엑셀 파일 데이터 내용이 누락되었습니다. 정상적인 양식인지 체크하세요.', 'error');
        return;
      }
      processRawExcelData(rawData);
    } catch (err) {
      console.error(err);
      showToast('올바르지 않은 엑셀 양식 혹은 규격 포맷입니다.', 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

function processRawExcelData(rows) {
  let headerIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const rowStr = row.join(',');
    if (rowStr.includes('좌석') || rowStr.includes('학번') || rowStr.includes('이름')) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    showToast('엑셀 열 분석 실패: "좌석", "학번", "이름" 헤더 행을 감지할 수 없습니다.', 'error');
    return;
  }

  const dateHeaders = rows[headerIndex] || [];
  let detectedDates = [];
  // F열 (인덱스 5)부터 3열 단위로 배치된 일자 헤더 추출
  for (let c = 5; c < dateHeaders.length; c += 3) {
    const dVal = dateHeaders[c];
    if (dVal && String(dVal).trim() !== "" && !String(dVal).includes("비고")) {
      detectedDates.push(String(dVal).trim());
    }
  }

  if (detectedDates.length === 0) {
    detectedDates = ["월(8일)", "화(9일)", "수(10일)", "목(11일)", "금(12일)"];
  }

  const parsedStudents = [];
  const studentStartRow = headerIndex + 2;

  for (let r = studentStartRow; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length < 5) continue;

    const seatNum = parseInt(row[0]);
    const studentId = parseInt(row[3]);
    const name = String(row[4] || '').trim();

    if (isNaN(studentId) || !name) continue;

    // ★ 학번 분석 로직 개선 (예: 12345 -> 1학년 23반 45번 / 10113 -> 1학년 1반 13번)
    const grade = Math.floor(studentId / 10000);
    const classVal = Math.floor((studentId % 10000) / 100);
    const num = studentId % 100;

    let exemptions = {};
    let colPtr = 5;
    detectedDates.forEach(date => {
      exemptions[date] = {
        "8교시": String(row[colPtr] || '').trim(),
        "1교시": String(row[colPtr+1] || '').trim(),
        "2교시": String(row[colPtr+2] || '').trim()
      };
      colPtr += 3;
    });

    parsedStudents.push({
      seat: isNaN(seatNum) ? parsedStudents.length + 1 : seatNum,
      grade: grade,
      class: classVal,
      num: num,
      id: studentId,
      name: name,
      exemptions: exemptions,
      rawRowIndex: r
    });
  }

  temporaryParsedData = {
    students: parsedStudents,
    dates: detectedDates
  };

  displayPreview();
}

function displayPreview() {
  const container = document.getElementById('preview-container');
  const countLabel = document.getElementById('preview-count');
  const tableBody = document.getElementById('preview-table-body');

  if (!temporaryParsedData || temporaryParsedData.students.length === 0) {
    showToast('유효한 학생 데이터 목록을 검출하지 못했습니다.', 'error');
    return;
  }

  if (countLabel) countLabel.textContent = `총 인원: ${temporaryParsedData.students.length}명 대기`;
  if (tableBody) {
    tableBody.innerHTML = "";

    const samples = temporaryParsedData.students.slice(0, 10);
    samples.forEach(s => {
      const row = document.createElement('tr');
      row.className = 'hover:bg-slate-50';
      let exSummary = "";
      const targetDate = temporaryParsedData.dates[0] || "";
      if (targetDate && s.exemptions[targetDate]) {
        const ex = s.exemptions[targetDate];
        if (ex["8교시"]) exSummary += `8교시(${ex["8교시"]}) `;
        if (ex["1교시"]) exSummary += `1교시(${ex["1교시"]}) `;
        if (ex["2교시"]) exSummary += `2교시(${ex["2교시"]}) `;
      }
      if (!exSummary) exSummary = "지정면제 없음";

      row.innerHTML = `
        <td class="px-3 py-2 font-bold text-slate-700 text-center bg-slate-50">${s.seat}번</td>
        <td class="px-3 py-2 text-slate-600 font-semibold">${s.id}</td>
        <td class="px-3 py-2 text-slate-900 font-extrabold">${s.name}</td>
        <td class="px-3 py-2 text-slate-500">${s.grade}학년 ${s.class}반 ${s.num}번</td>
        <td class="px-3 py-2 text-xs text-amber-600 font-semibold">${exSummary}</td>
      `;
      tableBody.appendChild(row);
    });

    if (temporaryParsedData.students.length > 10) {
      const extraRow = document.createElement('tr');
      extraRow.className = 'bg-slate-50';
      extraRow.innerHTML = `
        <td colspan="5" class="text-center py-2 text-xs text-slate-400 font-medium italic">
          외 ${temporaryParsedData.students.length - 10}명의 대기 인원이 분석 완료되었습니다.
        </td>
      `;
      tableBody.appendChild(extraRow);
    }
  }

  if (container) container.classList.remove('hidden');
  showToast('명단 엑셀 임시 가공 완료! 적용 단추를 누르면 모든 화면에 즉시 동기화됩니다.', 'info');
}

// 적용하기 클릭 시 실제 적용
function applyUploadedData() {
  if (!temporaryParsedData) {
    showToast('적용할 임시 로드 데이터 데이터가 비어있습니다.', 'warning');
    return;
  }

  masterStudents = temporaryParsedData.students;
  datesAvailable = temporaryParsedData.dates;
  selectedDate = datesAvailable[0] || "월(8일)";

  const banner = document.getElementById('warning-banner');
  if (banner) banner.classList.add('hidden');
  
  const statusIcon = document.getElementById('upload-status-icon');
  if (statusIcon) statusIcon.classList.remove('hidden');

  initFilterDropdowns();
  switchTeacherSubMenu('results');
  showToast('성공! 야자 마스터 명단이 시스템에 연동되었습니다.', 'success');

  // 구글 스프레드시트에 전체 데이터 백업 전송
  saveSystemData("save_system", { key: "master_students", value: masterStudents });
  saveSystemData("save_system", { key: "dates_available", value: datesAvailable });
  saveSystemData("save_system", { key: "attendance_database", value: attendanceDatabase });
  if (originalRawSheet) {
    saveSystemData("save_system", { key: "original_raw_sheet", value: originalRawSheet });
  }
}

function initFilterDropdowns() {
  const dateSelect = document.getElementById('filter-date');
  const classSelect = document.getElementById('filter-class');

  if (dateSelect) {
    dateSelect.innerHTML = "";
    datesAvailable.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      dateSelect.appendChild(opt);
    });
  }

  if (classSelect) {
    const classes = [...new Set(masterStudents.map(s => s.class))].sort((a,b) => a - b);
    classSelect.innerHTML = '<option value="all">전체 학급</option>';
    classes.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = `${c}반`;
      classSelect.appendChild(opt);
    });
  }

  // 널 세이프티 가드 추가: DOM 에 해당 요소가 존재할 때만 텍스트 대입하도록 전면 수정
  const mapSelectedDateEl = document.getElementById('map-selected-date');
  if (mapSelectedDateEl) {
    mapSelectedDateEl.textContent = selectedDate;
  }
}

// ==========================================
// 학생 출결 입력 처리단
// ==========================================
function processStudentCheckIn() {
  if (masterStudents.length === 0) {
    showToast('출석 데이터가 등록되지 않았습니다. 교사 전용 메뉴에서 엑셀 등록을 진행하세요.', 'error');
    return;
  }

  const inputId = document.getElementById('student-id-input').value.trim();
  const selectedRadio = document.querySelector('input[name="check-period"]:checked');
  
  if (!inputId) {
    showToast('학번을 바르게 입력하십시오.', 'warning');
    return;
  }

  const period = selectedRadio ? selectedRadio.value : '8교시';
  const student = masterStudents.find(s => String(s.id) === inputId);

  if (!student) {
    showToast(`면학 배정에 존재하지 않는 학번 [${inputId}] 입니다.`, 'error');
    return;
  }

  // 등록 처리
  const key = `${selectedDate}_${student.id}_${period}`;
  attendanceDatabase[key] = "출석";

  showToast(`[좌석 ${student.seat}번] ${student.name} 학생, ${period} 출석 처리가 확인되었습니다.`, 'success');
  
  const checkInInput = document.getElementById('student-id-input');
  if (checkInInput) checkInInput.value = "";

  // 구글 시트에 저장 및 로그 전송
  saveSystemData("log_attendance", {
    date: selectedDate,
    student_id: student.id,
    name: student.name,
    period: period,
    status: "출석"
  });
}

// ==========================================
// 명렬표 결과 출력
// ==========================================
function updateAttendanceTable() {
  const tableBody = document.getElementById('student-table-body');
  if (!tableBody || masterStudents.length === 0) return;

  const dateSelect = document.getElementById('filter-date');
  selectedDate = dateSelect ? dateSelect.value : (datesAvailable[0] || "");
  
  const classSelect = document.getElementById('filter-class');
  const selectedClass = classSelect ? classSelect.value : 'all';
  
  const searchInput = document.getElementById('search-student');
  const searchKeyword = searchInput ? searchInput.value.trim() : '';

  const mapSelectedDateEl = document.getElementById('map-selected-date');
  if (mapSelectedDateEl) {
    mapSelectedDateEl.textContent = selectedDate;
  }

  let filtered = masterStudents.filter(s => {
    if (selectedClass !== 'all' && String(s.class) !== selectedClass) return false;
    if (searchKeyword) {
      const idStr = String(s.id);
      if (!s.name.includes(searchKeyword) && !idStr.includes(searchKeyword)) {
        return false;
      }
    }
    return true;
  });

  // ★ 동적 정렬 방식 적용 (지정된 컬럼과 차순을 토대로 정렬)
  filtered.sort((a, b) => {
    let valA = currentSortColumn === "seat" ? a.seat : a.id;
    let valB = currentSortColumn === "seat" ? b.seat : b.id;

    if (currentSortOrder === "asc") {
      return valA - valB;
    } else {
      return valB - valA;
    }
  });

  tableBody.innerHTML = "";

  if (filtered.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-slate-400 font-semibold">조건에 맞는 결과가 없습니다.</td></tr>`;
    return;
  }

  filtered.forEach(s => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50 transition-all border-b border-slate-100';

    const status8 = getAttendanceStatus(s, '8교시', selectedDate);
    const status1 = getAttendanceStatus(s, '1교시', selectedDate);
    const status2 = getAttendanceStatus(s, '2교시', selectedDate);

    tr.innerHTML = `
      <td class="px-4 py-3 text-center font-bold text-slate-800 bg-slate-50/50">${s.seat}번</td>
      <td class="px-4 py-3 text-center font-semibold text-slate-700">${s.id}</td>
      <td class="px-4 py-3 text-center font-black text-blue-950">${s.name}</td>
      <td class="px-4 py-3 text-center text-slate-500 text-xs">${s.class}반 ${s.num}번</td>
      
      <td class="px-4 py-3 text-center font-bold ${getStatusBgClass(status8)}">${status8}</td>
      <td class="px-4 py-3 text-center font-bold ${getStatusBgClass(status1)}">${status1}</td>
      <td class="px-4 py-3 text-center font-bold ${getStatusBgClass(status2)}">${status2}</td>

      <td class="px-4 py-2 text-center whitespace-nowrap">
        <div class="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
          <button onclick="toggleAttendanceManual(${s.id}, '8교시')" class="px-2 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-100 rounded">8교시</button>
          <button onclick="toggleAttendanceManual(${s.id}, '1교시')" class="px-2 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-100 rounded border-l border-r border-slate-100">1교시</button>
          <button onclick="toggleAttendanceManual(${s.id}, '2교시')" class="px-2 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-100 rounded">2교시</button>
        </div>
      </td>
    `;
    tableBody.appendChild(tr);
  });
}

// ==========================================
// 정렬 제어 및 아이콘 토글 유틸리티
// ==========================================
function handleSort(column) {
  if (currentSortColumn === column) {
    currentSortOrder = currentSortOrder === "asc" ? "desc" : "asc";
  } else {
    currentSortColumn = column;
    currentSortOrder = "asc";
  }
  updateSortIcons();
  updateAttendanceTable();
}

function updateSortIcons() {
  const seatIcon = document.getElementById('sort-icon-seat');
  const idIcon = document.getElementById('sort-icon-id');
  
  if (seatIcon) {
    if (currentSortColumn === 'seat') {
      seatIcon.innerHTML = currentSortOrder === 'asc' 
        ? '<i class="fa-solid fa-sort-up text-blue-600"></i>' 
        : '<i class="fa-solid fa-sort-down text-blue-600"></i>';
    } else {
      seatIcon.innerHTML = '<i class="fa-solid fa-sort text-slate-300"></i>';
    }
  }
  
  if (idIcon) {
    if (currentSortColumn === 'id') {
      idIcon.innerHTML = currentSortOrder === 'asc' 
        ? '<i class="fa-solid fa-sort-up text-blue-600"></i>' 
        : '<i class="fa-solid fa-sort-down text-blue-600"></i>';
    } else {
      idIcon.innerHTML = '<i class="fa-solid fa-sort text-slate-300"></i>';
    }
  }
}

// 정교한 출석 판단기 (날짜 유동 지정형으로 개선)
function getAttendanceStatus(student, period, dateStr) {
  const targetDate = dateStr || selectedDate;
  const key = `${targetDate}_${student.id}_${period}`;

  if (attendanceDatabase[key] === "출석") {
    return "출석";
  }
  if (attendanceDatabase[key] === "미출석") {
    return "미출석";
  }

  if (student.exemptions[targetDate] && student.exemptions[targetDate][period]) {
    return student.exemptions[targetDate][period];
  }

  return "미출석";
}

function getStatusBgClass(status) {
  if (status === "출석") return "bg-blue-50 text-blue-700 font-extrabold";
  if (status === "미출석" || !status) return "text-slate-300";
  return "bg-amber-50 text-amber-700 text-xs font-semibold";
}

function toggleAttendanceManual(studentId, period) {
  const key = `${selectedDate}_${studentId}_${period}`;
  const student = masterStudents.find(s => s.id === studentId);
  if (!student) return;

  const current = getAttendanceStatus(student, period, selectedDate);
  let newStatus = "";
  if (current === "출석") {
    attendanceDatabase[key] = "미출석";
    newStatus = "미출석";
    showToast(`${student.name} 학생의 ${period} 상태를 미출석으로 지정했습니다.`, 'info');
  } else {
    attendanceDatabase[key] = "출석";
    newStatus = "출석";
    showToast(`${student.name} 학생의 ${period} 상태를 수동 출석 지정했습니다.`, 'success');
  }
  saveSystemData("log_attendance", {
    date: selectedDate,
    student_id: student.id,
    name: student.name,
    period: period,
    status: newStatus
  });
  updateAttendanceTable();
  renderCompleteLayoutMap();
}

// ==========================================
// 서브탭 2: 배치도 교시 변경
// ==========================================
function setMapPeriod(p) {
  selectedPeriod = p;
  ['8교시', '1교시', '2교시'].forEach(period => {
    const btnId = `btn-map-${period === '8교시' ? '8' : period === '1교시' ? '1' : '2'}`;
    const btn = document.getElementById(btnId);
    if (btn) {
      if (period === p) {
        btn.className = "px-2.5 py-1 text-[11px] font-bold rounded-md bg-white shadow-sm text-slate-800";
      } else {
        btn.className = "px-2.5 py-1 text-[11px] font-semibold rounded-md text-slate-500 hover:bg-slate-100/50";
      }
    }
  });
  renderCompleteLayoutMap();
}

// ==========================================
// 실물 배치 도면 100% 동기화 매핑 설계
// ==========================================
function renderCompleteLayoutMap() {
  if (masterStudents.length === 0) return;

  // 1. 좌측 구역 TOP 그리드 렌더링 (78~71 역순 / 49~56 정순)
  const leftTop = document.getElementById('map-left-grid-top');
  if (leftTop) {
    leftTop.innerHTML = "";
    const leftTopPairs = [
      [78, 49], [77, 50], [76, 51], [75, 52], [74, 53], [73, 54], [72, 55], [71, 56]
    ];
    leftTopPairs.forEach(pair => {
      leftTop.appendChild(createSeatCard(pair[0]));
      leftTop.appendChild(createSeatCard(pair[1]));
    });
  }

  // 2. 좌측 구역 BOTTOM 그리드 렌더링 (70~64 역순 / 57~63 정순)
  const leftBottom = document.getElementById('map-left-grid-bottom');
  if (leftBottom) {
    leftBottom.innerHTML = "";
    const leftBottomPairs = [
      [70, 57], [69, 58], [68, 59], [67, 60], [66, 61], [65, 62], [64, 63]
    ];
    leftBottomPairs.forEach(pair => {
      leftBottom.appendChild(createSeatCard(pair[0]));
      leftBottom.appendChild(createSeatCard(pair[1]));
    });
  }

  // 3. 좌측 구역 추가 좌석 (자유석 12, 자유석 13)
  const leftExtra = document.getElementById('map-left-extra');
  if (leftExtra) {
    leftExtra.innerHTML = "";
    leftExtra.appendChild(createSeatCard("자유석(12)"));
    leftExtra.appendChild(createSeatCard("자유석(13)"));
  }

  // 4. 중앙 구역 TOP 그리드 렌더링 (48~41 역순 / 19~26 정순)
  const midTop = document.getElementById('map-mid-grid-top');
  if (midTop) {
    midTop.innerHTML = "";
    const midTopPairs = [
      [48, 19], [47, 20], [46, 21], [45, 22], [44, 23], [43, 24], [42, 25], [41, 26]
    ];
    midTopPairs.forEach(pair => {
      midTop.appendChild(createSeatCard(pair[0]));
      midTop.appendChild(createSeatCard(pair[1]));
    });
  }

  // 5. 중앙 구역 BOTTOM 그리드 렌더링 (40~34 역순 / 27~33 정순)
  const midBottom = document.getElementById('map-mid-grid-bottom');
  if (midBottom) {
    midBottom.innerHTML = "";
    const midBottomPairs = [
      [40, 27], [39, 28], [38, 29], [37, 30], [36, 31], [35, 32], [34, 33]
    ];
    midBottomPairs.forEach(pair => {
      midBottom.appendChild(createSeatCard(pair[0]));
      midBottom.appendChild(createSeatCard(pair[1]));
    });
  }

  // 6. 중앙 구역 추가 좌석 (자유석 14, 자유석 15)
  const midExtra = document.getElementById('map-mid-extra');
  if (midExtra) {
    midExtra.innerHTML = "";
    midExtra.appendChild(createSeatCard("자유석(14)"));
    midExtra.appendChild(createSeatCard("자유석(15)"));
  }

  // 7. 우측 단독 복도석 + 기둥 배치 렌더링
  const rightCol = document.getElementById('map-right-column');
  if (rightCol) {
    rightCol.innerHTML = "";

    // 도면 우측 열 전체 요소 배열화
    const rightLayoutItems = [
      18, 17, 16, 15, 14, 13,
      { type: 'pillar', label: '기둥 1' },
      12, 11, 10, 9, 8, 7,
      { type: 'pillar', label: '기둥 2' },
      6, 5, 4, 3,
      { type: 'pillar', label: '기둥 3' },
      2, 1,
      { type: 'door', label: '출입문' }
    ];

    rightLayoutItems.forEach(item => {
      if (typeof item === 'object') {
        if (item.type === 'pillar') {
          const pBox = document.createElement('div');
          pBox.className = "bg-slate-700/60 border border-slate-600/40 rounded-lg py-2.5 text-center text-[10px] text-slate-400 font-extrabold shadow-inner";
          pBox.textContent = "기 둥";
          rightCol.appendChild(pBox);
        } else if (item.type === 'door') {
          const dBox = document.createElement('div');
          dBox.className = "bg-red-950/40 border border-red-900 text-red-300 rounded-lg py-3 text-center text-xs font-black tracking-wider flex items-center justify-center space-x-1.5 shadow-sm";
          dBox.innerHTML = `<i class="fa-solid fa-door-open text-xs"></i> <span>출 입 문</span>`;
          rightCol.appendChild(dBox);
        }
      } else {
        rightCol.appendChild(createSeatCard(item));
      }
    });
  }
}

// 개별 시트 카드 엘리먼트 생성기
function createSeatCard(seatIdentifier) {
  const student = masterStudents.find(s => s.seat === seatIdentifier || (isNaN(seatIdentifier) && String(s.seat) === String(seatIdentifier)));
  const seatBox = document.createElement('div');

  if (student) {
    const status = getAttendanceStatus(student, selectedPeriod, selectedDate);
    const isAttended = (status === "출석");
    const isExempt = (status !== "출석" && status !== "미출석" && status !== "");

    let bgClass = "bg-slate-800/40 border-slate-700 text-slate-300 hover:border-slate-500 hover:bg-slate-800/80";
    let badgeColor = "bg-slate-800 text-slate-400";

    if (isAttended) {
      // 출석 상태만 명확한 블루 톤으로 표시 요청 사항 충족
      bgClass = "bg-blue-600 border-blue-400 text-white hover:bg-blue-500 shadow-lg shadow-blue-900/30 ring-2 ring-blue-500 ring-offset-1 ring-offset-slate-900";
      badgeColor = "bg-blue-800 text-blue-200";
    } else if (isExempt) {
      bgClass = "bg-amber-500/10 border-amber-500/40 text-amber-300 hover:border-amber-400/80 hover:bg-amber-500/20";
      badgeColor = "bg-amber-950/60 text-amber-200";
    }

    seatBox.className = `${bgClass} border rounded-lg p-2 flex flex-col justify-between h-16 cursor-pointer transition-all duration-200 relative select-none`;
    seatBox.setAttribute('onclick', `toggleAttendanceManual(${student.id}, '${selectedPeriod}')`);
    seatBox.title = `[좌석 ${student.seat}] ${student.name} (${student.grade}학년 ${student.class}반 ${student.num}번) - 현재 상태: ${status}`;

    const shortName = student.name.length > 3 ? student.name.substring(0, 3) + ".." : student.name;

    seatBox.innerHTML = `
      <div class="flex justify-between items-center text-[9px] pointer-events-none">
        <span class="font-extrabold px-1 rounded ${badgeColor}">${seatIdentifier}</span>
        <span class="opacity-60 text-[8px]">${student.grade}-${student.class}</span>
      </div>
      <div class="text-center font-black text-xs tracking-wide pointer-events-none mt-0.5">
        ${shortName}
      </div>
      <div class="text-[8px] truncate text-center mt-0.5 opacity-85 font-medium max-w-full pointer-events-none">
        ${status === '미출석' ? '공석' : status}
      </div>
    `;
  } else {
    // 배정되지 않은 완전 공석 카드
    seatBox.className = "bg-slate-950/25 border border-slate-800/70 rounded-lg p-2 flex flex-col items-center justify-center h-16 text-slate-600 border-dashed";
    seatBox.innerHTML = `
      <span class="text-[9px] font-black opacity-30">${seatIdentifier}</span>
      <span class="text-[8px] mt-1 font-medium opacity-15">배정없음</span>
    `;
  }
  return seatBox;
}

// ==========================================
// 원본 서식 완벽 보존형 엑셀 다운로드 (버그 제거판)
// ==========================================
function exportToExcel() {
  if (!originalRawSheet) {
    showToast('출석 데이터 원본 템플릿이 존재하지 않아 파일을 다운로드할 수 없습니다.', 'error');
    return;
  }

  // 1. 메모리 오버라이트를 방지하기 위해 SheetJS 셀 구조를 정밀하게 딥 카피 진행
  const worksheetCopy = {};
  for (let cellKey in originalRawSheet) {
    if (originalRawSheet.hasOwnProperty(cellKey)) {
      if (typeof originalRawSheet[cellKey] === 'object' && originalRawSheet[cellKey] !== null) {
        worksheetCopy[cellKey] = { ...originalRawSheet[cellKey] };
      } else {
        worksheetCopy[cellKey] = originalRawSheet[cellKey];
      }
    }
  }

  // 2. 파싱 및 감지된 모든 출석 날짜 루프
  datesAvailable.forEach((date, dateIdx) => {
    // 날짜별 시작 열 계산: F열 (인덱스 5)부터 3열씩 우측 이동
    const dateStartCol = 5 + dateIdx * 3;

    // 3. 전체 학생 데이터에 대한 셀 대입 업데이트
    masterStudents.forEach(student => {
      const rIndex = student.rawRowIndex;
      const periods = ["8교시", "1교시", "2교시"];

      periods.forEach((period, pIdx) => {
        const targetCol = dateStartCol + pIdx;
        const cellAddress = XLSX.utils.encode_cell({ r: rIndex, c: targetCol });
        
        // 현재 일자별/교시별 상태 조회
        const currentStatus = getAttendanceStatus(student, period, date);

        if (currentStatus === "출석") {
          worksheetCopy[cellAddress] = { t: 's', v: '출석' };
        } else if (currentStatus === "미출석") {
          worksheetCopy[cellAddress] = { t: 's', v: '' }; // 공란 복구
        } else {
          // 방과후, 두드림 등 기존 비고 상태가 존재하는 경우 보존
          worksheetCopy[cellAddress] = { t: 's', v: currentStatus };
        }
      });
    });
  });

  // 4. 단일 시트 기반 워크북 빌드
  const newWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(newWorkbook, worksheetCopy, "면학관 출석부");

  // 5. 파일명 및 다운로드 트리거
  const finalFileName = `면학관_출석부_출석반영_${selectedDate}.xlsx`;
  XLSX.writeFile(newWorkbook, finalFileName);
  showToast(`${finalFileName} 형식의 출결 엑셀 파일이 정상 보존 다운로드되었습니다.`, 'success');
}
// saveToGoogleSheet 함수는 상단의 saveSystemData 함수로 이전 및 통합 구현되었습니다.
