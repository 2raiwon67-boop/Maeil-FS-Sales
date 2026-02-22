const fs = require('fs');

const SHEETS_CONFIG = {
    visitLogs: {
        id: '1JnLQVr3JGqZPyvQ6bf8TSl0dNN6_oI05YH7d9zSgsKI',
        gid: '7066983'
    },
    accounts: {
        id: '1JnLQVr3JGqZPyvQ6bf8TSl0dNN6_oI05YH7d9zSgsKI',
        gid: '43116531'
    },
    licenses: {
        id: '1JnLQVr3JGqZPyvQ6bf8TSl0dNN6_oI05YH7d9zSgsKI',
        gid: '0'
    }
};

function parseCSV(text) {
    const lines = [];
    let currentLine = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                currentField += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            currentLine.push(currentField.trim());
            currentField = '';
        } else if ((char === '\n' || char === '\r') && !inQuotes) {
            if (currentField || currentLine.length > 0) {
                currentLine.push(currentField.trim());
                if (currentLine.some(f => f)) {
                    lines.push(currentLine);
                }
                currentLine = [];
                currentField = '';
            }
            if (char === '\r' && nextChar === '\n') {
                i++;
            }
        } else {
            currentField += char;
        }
    }

    if (currentField || currentLine.length > 0) {
        currentLine.push(currentField.trim());
        if (currentLine.some(f => f)) {
            lines.push(currentLine);
        }
    }

    if (lines.length > 1) {
        const headers = lines[0];
        return lines.slice(1).map(values => {
            const obj = {};
            headers.forEach((h, i) => {
                obj[h] = values[i] || '';
            });
            return obj;
        });
    }

    return [];
}

async function test() {
    try {
        const url = `https://docs.google.com/spreadsheets/d/${SHEETS_CONFIG.visitLogs.id}/export?format=csv&gid=${SHEETS_CONFIG.visitLogs.gid}`;
        const response = await fetch(url);
        const csv = await response.text();
        const allVisitLogs = parseCSV(csv).filter(row => row['작성자'] && row['작성자'].trim() !== '');
        console.log(`방문일지 로드 완료: ${allVisitLogs.length}건`);
        if (allVisitLogs.length > 0) {
            console.log('첫번째 로그 예시:', allVisitLogs[0]);
        } else {
            console.log('csv:\n', csv.substring(0, 500));
        }
    } catch (e) {
        console.error(e);
    }
}

test();
