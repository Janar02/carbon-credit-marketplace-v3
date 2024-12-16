import { NavBar } from "./NavBar";

export default function MarketplaceDashboard(){
    return (
        <div className="min-h-screen flex flex-col">
            <div className="flex-grow container mx-auto p-4">
                <NavBar/>
            </div>
        </div>
    )
}