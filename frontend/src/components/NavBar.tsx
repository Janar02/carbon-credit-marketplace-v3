import { client } from "@/app/client";
import { baseChain, carbonTokenContractAddress, wallets } from "@/constants/constants";
import { ConnectButton, lightTheme } from "thirdweb/react";

export function NavBar(){
    return(
        <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-bold">Carbon Credits Marketplace</h1>
            <div className="items-center flex gap-2">
                <ConnectButton
                    client={client}
                    // wallets={wallets}
                    theme={lightTheme()}
                    chain={baseChain}
                    connectButton={{
                        label: "Sign In",
                        style: {
                            fontSize: '0.75rem !important',
                            height: '2.5rem !important'
                        }
                    }}
                    accountAbstraction={{
                        chain: baseChain,
                        sponsorGas: true,
                    }}
                    // Comment in to showcase your own token balance
                    // detailsButton={{
                    //     displayBalanceToken:{
                    //         [baseChain.id]: carbonTokenContractAddress
                    //     }
                    // }}
                />
            </div>
        </div>
    )
}