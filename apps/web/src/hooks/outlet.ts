import { useOutletContext } from 'react-router-dom';

/** Layout'dagi umumiy vazifa panelini ochish */
export const useOpenTask = () => useOutletContext<{ openTask: (id: number) => void }>().openTask;
