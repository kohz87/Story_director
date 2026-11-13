// Selects the opening foe groups for a board fight's single win award.
// It reads the current reply's recorded board result, including fights split across replies.
// A still-open, lost or fled board fight never pays a win award.

export function boardWin(receipts) {
    const receipt = (Array.isArray(receipts) ? receipts : []).findLast(item => item?.type === 'rpg.resolve' && item.data?.v2?.result?.board);
    const result = receipt?.data?.v2?.result;
    if (!result) return null;
    return { won: result.stop === 'won', groups: Array.isArray(result.board.groups) ? result.board.groups : [], bars: result.bars === 2, cleared: Array.isArray(result.cleared) && result.cleared.length > 0,
        claim: typeof receipt.data?.v2?.key === 'string' ? receipt.data.v2.key : null };
}
