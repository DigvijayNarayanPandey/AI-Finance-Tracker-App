import React, { useState } from 'react';
import Input from "../Inputs/Input";
import EmojiPickerPopup from "../EmojiPickerPopup";
import { EXPENSE_CATEGORIES, normalizeCategory } from "../../utils/aiConstants";
import { getLocalISODate } from "../../utils/aiValidation";

const AddExpenseForm = ({ onAddExpense }) => {

    const [income, setIncome] = useState({
        amount: "",
        category: "",
        date: "",
        icon: "",
    });

    const handleChange = (key, value) => setIncome({ ...income, [key]: value });

    return (
        <div>
            <EmojiPickerPopup
                icon={income.icon}
                onSelect={(selectedIcon) => handleChange("icon", selectedIcon)}
            />

            {/* Quick-pick chips — tap to fill the Category field with a canonical name */}
            <div className="mb-2">
                <label className="text-[13px] text-slate-800 dark:text-slate-300 mb-2 block">
                    Quick pick
                </label>
                <div className="flex flex-wrap gap-2">
                    {EXPENSE_CATEGORIES.map((cat) => {
                        const isSelected =
                            income.category.trim().toLowerCase() === cat.toLowerCase();
                        return (
                            <button
                                key={cat}
                                type="button"
                                onClick={() => handleChange("category", cat)}
                                className={`text-xs font-medium rounded-lg px-3 py-1.5 border cursor-pointer transition-colors ${
                                    isSelected
                                        ? "text-white bg-primary border-primary"
                                        : "text-primary bg-teal-50 dark:bg-primary/10 border-teal-100 dark:border-primary/20 hover:bg-teal-100 dark:hover:bg-primary/20"
                                }`}
                            >
                                {cat}
                            </button>
                        );
                    })}
                </div>
            </div>

            <Input
                value={income.category}
                onChange={({ target }) => handleChange("category", target.value)}
                label="Category"
                placeholder="Rent, Groceries, etc"
                type="text"
            />

            <Input
                value={income.amount}
                onChange={({ target }) => handleChange("amount", target.value)}
                label="Amount"
                placeholder="0.00"
                type="number"
            />

            <Input
                value={income.date}
                onChange={({ target }) => handleChange("date", target.value)}
                label="Date"
                placeholder=""
                type="date"
                max={getLocalISODate()}
            />

            <div className='flex justify-end mt-6'>
                <button
                    className="add-btn add-btn-fill"
                    type="button"
                    onClick={() => onAddExpense({ ...income, category: normalizeCategory(income.category) })}
                >
                    Add Expense
                </button>
            </div>
        </div>
    );
};

export default AddExpenseForm;
