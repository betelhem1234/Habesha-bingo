import { InlineKeyboard } from 'grammy';
import { config } from '../config';

export type BingoTicket = number[][];

// Column color emojis for B I N G O
export const COLUMN_COLORS = ['🔵', '🟣', '🟢', '🟡', '🔴'];
export const COLUMN_LETTERS = ['B', 'I', 'N', 'G', 'O'];

export function generateTicket(seed?: number): BingoTicket {
    const rand = seed ? mulberry32(seed) : Math.random;
    const ticket: number[][] = [];
    for (let i = 0; i < 5; i++) ticket[i] = [];

    const ranges = [
        { min: 1, max: 15 },
        { min: 16, max: 30 },
        { min: 31, max: 45 },
        { min: 46, max: 60 },
        { min: 61, max: 75 }
    ];

    for (let col = 0; col < 5; col++) {
        const numbers = new Set<number>();
        while (numbers.size < 5) {
            const num = Math.floor(rand() * (ranges[col].max - ranges[col].min + 1)) + ranges[col].min;
            numbers.add(num);
        }
        const colNums = Array.from(numbers);
        for (let row = 0; row < 5; row++) {
            if (col === 2 && row === 2) {
                ticket[row][col] = 0; // FREE space
            } else {
                ticket[row][col] = colNums[row];
            }
        }
    }
    return ticket;
}

// Deterministic PRNG (mulberry32) so each board number produces the same card
function mulberry32(seed: number) {
    return function () {
        seed |= 0;
        seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function getNumberName(num: number): string {
    if (num <= 15) return `B-${num}`;
    if (num <= 30) return `I-${num}`;
    if (num <= 45) return `N-${num}`;
    if (num <= 60) return `G-${num}`;
    return `O-${num}`;
}

export function getColumnEmoji(num: number): string {
    if (num <= 15) return COLUMN_COLORS[0]; // B 🔵
    if (num <= 30) return COLUMN_COLORS[1]; // I 🟣
    if (num <= 45) return COLUMN_COLORS[2]; // N 🟢
    if (num <= 60) return COLUMN_COLORS[3]; // G 🟡
    return COLUMN_COLORS[4];               // O 🔴
}

export function createTicketKeyboard(ticket: number[][], daubed: Set<number>, userId: bigint): InlineKeyboard {
    const kb = new InlineKeyboard();
    
    // In production (when you have a domain with HTTPS), you change .url to .webApp
    // e.g. .webApp("🎮 PLAY BINGO", `https://yourdomain.com/game.html?userId=${userId}`)
    
    kb.webApp("🎮 OPEN INTERACTIVE BOARD 🎮", `${config.BINGO_APP_URL}/game.html?userId=${userId}`);
    
    return kb;
}

export interface WinResult {
    hasWon: boolean;
    winningCells: { row: number; col: number }[];
}

export interface FreshWinResult {
    hasWon: boolean;
    isFresh: boolean; // True if winning pattern contains the current ball
    winningCells: { row: number; col: number }[];
}

export function checkWinFreshness(ticket: BingoTicket, daubedNumbers: Set<number>, currentBall?: number): FreshWinResult {
    const allPatterns: { cells: { row: number; col: number }[] }[] = [];

    // Rows
    for (let r = 0; r < 5; r++) {
        allPatterns.push({ cells: [0, 1, 2, 3, 4].map(c => ({ row: r, col: c })) });
    }
    // Columns
    for (let c = 0; c < 5; c++) {
        allPatterns.push({ cells: [0, 1, 2, 3, 4].map(r => ({ row: r, col: c })) });
    }
    // Main diagonal (\)
    allPatterns.push({ cells: [0, 1, 2, 3, 4].map(i => ({ row: i, col: i })) });
    // Anti-diagonal (/)
    allPatterns.push({ cells: [0, 1, 2, 3, 4].map(i => ({ row: i, col: 4 - i })) });
    // 4 Corners
    allPatterns.push({
        cells: [
            { row: 0, col: 0 },
            { row: 0, col: 4 },
            { row: 4, col: 0 },
            { row: 4, col: 4 }
        ]
    });

    let completedPattern: { cells: { row: number; col: number }[] } | null = null;
    let freshCompletedPattern: { cells: { row: number; col: number }[] } | null = null;

    for (const pat of allPatterns) {
        const isComplete = pat.cells.every(cell => {
            const num = ticket[cell.row][cell.col];
            return num === 0 || daubedNumbers.has(num);
        });

        if (isComplete) {
            if (!completedPattern) completedPattern = pat;

            if (currentBall !== undefined) {
                const containsCurrent = pat.cells.some(cell => ticket[cell.row][cell.col] === currentBall);
                if (containsCurrent) {
                    freshCompletedPattern = pat;
                    break; // Found fresh pattern matching current ball!
                }
            } else {
                freshCompletedPattern = pat;
                break;
            }
        }
    }

    if (freshCompletedPattern) {
        return {
            hasWon: true,
            isFresh: true,
            winningCells: freshCompletedPattern.cells
        };
    }

    if (completedPattern) {
        return {
            hasWon: true,
            isFresh: false,
            winningCells: completedPattern.cells
        };
    }

    return {
        hasWon: false,
        isFresh: false,
        winningCells: []
    };
}

export function checkWinDetails(ticket: BingoTicket, daubedNumbers: Set<number>): WinResult {
    const res = checkWinFreshness(ticket, daubedNumbers);
    return { hasWon: res.hasWon, winningCells: res.winningCells };
}

export function checkWin(ticket: BingoTicket, daubedNumbers: Set<number>): boolean {
    return checkWinDetails(ticket, daubedNumbers).hasWon;
}
